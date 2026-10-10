import assert from "node:assert/strict";

const base = process.env.SECURITY_SMOKE_URL ?? "http://127.0.0.1:3000";
const readinessToken = process.env.READINESS_TOKEN ?? "";
const setupToken = process.env.SETUP_TOKEN ?? "";

async function request(path: string, init: RequestInit = {}) {
  return fetch(new URL(path, base), { redirect: "manual", ...init });
}

async function main() {
  const sameOriginHeaders = {
    origin: base,
    "sec-fetch-site": "same-origin",
  };

  const homepage = await request("/");
  assert.equal(homepage.status, 200, "homepage must load");
  const csp = homepage.headers.get("content-security-policy") ?? "";
  assert.match(csp, /frame-ancestors 'none'/, "CSP must block framing");
  assert.equal(homepage.headers.get("x-frame-options"), "DENY");
  assert.equal(homepage.headers.get("x-content-type-options"), "nosniff");
  assert.ok(homepage.headers.get("strict-transport-security"), "production build must emit HSTS");

  const crossSiteReset = await request("/api/auth/forgot-password", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    },
    body: JSON.stringify({ email: "victim@example.com" }),
  });
  assert.equal(crossSiteReset.status, 403, "cross-site credential mutation must be blocked");

  const apiWithoutKey = await request("/api/v1/employees");
  assert.equal(apiWithoutKey.status, 401, "public API must require an API key");

  const workerWithoutToken = await request("/api/jobs/tick", {
    method: "POST",
    headers: sameOriginHeaders,
  });
  assert.equal(workerWithoutToken.status, 401, "scheduler endpoint must require a worker token");

  const readinessWithoutToken = await request("/api/readiness");
  assert.equal(readinessWithoutToken.status, 401, "production readiness must not be public");

  const readinessWithToken = await request("/api/readiness", {
    headers: { "x-readiness-token": readinessToken },
  });
  assert.equal(readinessWithToken.status, 200, "valid readiness token must authorize diagnostics");

  const setupWithoutToken = await request("/api/setup", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...sameOriginHeaders,
    },
    body: JSON.stringify({
      companyName: "Attacker Co",
      name: "Attacker",
      email: "attacker@example.com",
      password: "AttackerPassword2026",
    }),
  });
  assert.equal(setupWithoutToken.status, 401, "production setup must require SETUP_TOKEN");

  const setup = await request("/api/setup", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-setup-token": setupToken,
    },
    body: JSON.stringify({
      companyName: "Security Test Company",
      legalName: "Security Test Company Inc.",
      name: "Security Owner",
      email: "security-owner@example.test",
      password: "SecurityOwnerPassword2026",
    }),
  });
  assert.equal(setup.status, 201, "valid setup token must bootstrap an empty production database");
  const setupBody = await setup.json() as { organizationId: number };
  assert.ok(Number.isInteger(setupBody.organizationId));

  const setCookie = setup.headers.get("set-cookie") ?? "";
  const sessionCookie = setCookie.split(";")[0];
  assert.ok(sessionCookie.includes("="), "setup must issue a session cookie");

  const crossSiteDeveloper = await request("/api/developer", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: sessionCookie,
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    },
    body: JSON.stringify({ action: "create-api-key", organizationId: setupBody.organizationId, name: "evil" }),
  });
  assert.equal(crossSiteDeveloper.status, 403, "authenticated cookies must not bypass CSRF protection");

  const foreignTenantDeveloper = await request("/api/developer", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: sessionCookie,
      ...sameOriginHeaders,
    },
    body: JSON.stringify({ action: "create-api-key", organizationId: setupBody.organizationId + 9999, name: "foreign" }),
  });
  assert.equal(foreignTenantDeveloper.status, 403, "authenticated users must not cross tenant boundaries");

  const privilegedWithoutMfa = await request("/api/developer", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: sessionCookie,
      ...sameOriginHeaders,
    },
    body: JSON.stringify({ action: "create-api-key", organizationId: setupBody.organizationId, name: "should-not-mint" }),
  });
  assert.equal(privilegedWithoutMfa.status, 403, "privileged developer action must require MFA");
  const privilegedBody = await privilegedWithoutMfa.json() as { code?: string };
  assert.equal(privilegedBody.code, "MFA_REQUIRED");

  // Governed Automation Studio drafting: check the actual production HTTP boundary.
  const automationReadAnonymous = await request(
    `/api/automation-studio?organizationId=${setupBody.organizationId}`,
  );
  assert.equal(automationReadAnonymous.status, 401, "Automation Studio must not disclose workflows anonymously");

  const languageDraftPayload = {
    organizationId: setupBody.organizationId,
    action: "draft-from-language",
    request: "When a new employee is hired, create an onboarding checklist and send them a welcome email.",
  };
  const automationWriteAnonymous = await request("/api/automation-studio", {
    method: "POST",
    headers: { "content-type": "application/json", ...sameOriginHeaders },
    body: JSON.stringify(languageDraftPayload),
  });
  assert.equal(automationWriteAnonymous.status, 401, "Anonymous users must not generate a workflow");

  const automationCrossSite = await request("/api/automation-studio", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: sessionCookie,
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    },
    body: JSON.stringify(languageDraftPayload),
  });
  assert.equal(automationCrossSite.status, 403, "Cross-site draft generation must be blocked");

  const automationForeignTenant = await request("/api/automation-studio", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sessionCookie, ...sameOriginHeaders },
    body: JSON.stringify({ ...languageDraftPayload, organizationId: setupBody.organizationId + 9999 }),
  });
  assert.equal(automationForeignTenant.status, 403, "A user must not create drafts in another company");

  const languageWithoutMfa = await request("/api/automation-studio", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sessionCookie, ...sameOriginHeaders },
    body: JSON.stringify(languageDraftPayload),
  });
  assert.equal(languageWithoutMfa.status, 403, "Drafting requires recent MFA for privileged users");
  assert.equal((await languageWithoutMfa.json() as { code?: string }).code, "MFA_REQUIRED");

  const forgedSaveWithoutMfa = await request("/api/automation-studio", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sessionCookie, ...sameOriginHeaders },
    body: JSON.stringify({
      organizationId: setupBody.organizationId,
      action: "save-language-draft",
      draft: { name: "Forged", trigger: "employee.hired", conditions: { version: 1, all: [], any: [] }, actions: [{ type: "create_task", title: "Forged", owner: "People Ops" }] },
      proposalReceipt: "invalid",
    }),
  });
  assert.equal(forgedSaveWithoutMfa.status, 403, "Signed draft saves must require MFA");

  const employeePortalAsOwner = await request("/api/self/payslips", {
    headers: { cookie: sessionCookie },
  });
  assert.equal(employeePortalAsOwner.status, 403, "owner session must not impersonate employee self-service");

  console.log("Security HTTP smoke passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
