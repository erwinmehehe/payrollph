import assert from "node:assert/strict";
import { chromium } from "playwright";

/** Synthetic-only direct-route enforcement browser QA on a separate localhost instance. */
const url = "http://127.0.0.1:3002";
const env = process.env;
assert.equal(env.CI, "true");
assert.equal(env.HCM_MONITOR_ACCEPTANCE_MODE, "synthetic-postgres-only");
assert.equal(env.HCM_ENTERPRISE_PLAN_GATE_ENABLED, "true");
assert.equal(env.HCM_ENTERPRISE_PLAN_GATE_ORG_IDS, "1,2");
assert.equal(env.OPENAI_API_KEY ?? "", "");
const database = new URL(env.DATABASE_URL ?? "");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
assert.equal(database.pathname, "/app_db");

const browser = await chromium.launch({ headless: true });
const receipts = [];
async function login(context, email) {
  const response = await context.request.post(url + "/api/auth/login", {
    headers: {
      origin: url, "sec-fetch-site": "same-origin", "content-type": "application/json",
    },
    data: { email, password: "Synthetic-HCM-Monitor-Only-2026!" },
    failOnStatusCode: false,
  });
  assert.equal(response.status(), 200, "Fictional login failed: " + email);
}
async function read(page, path) {
  return page.evaluate(async (path) => {
    const r = await fetch(path, { credentials: "same-origin", cache: "no-store" });
    return {
      status: r.status,
      headers: r.headers.get("cache-control"),
      body: await r.json().catch(() => null),
    };
  }, path);
}
async function write(page, path, payload) {
  // Real same-origin session, not Playwright's detached cookie jar.
  return page.evaluate(async ({ path, payload }) => {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return {
      status: response.status,
      headers: response.headers.get("cache-control"),
      body: await response.json().catch(() => null),
    };
  }, { path, payload });
}

async function open(page, path) {
  const result = await page.goto(url + path, { waitUntil: "domcontentloaded", timeout: 60000 });
  return result?.status();
}

try {
  const hr = await browser.newContext();
  await login(hr, "monitor-hr@example.test");
  const page = await hr.newPage();

  // No inferred account-type upgrade: company A has a recorded paid Enterprise
  // subscription and company B a recorded paid Core subscription.
  assert.equal(await open(page, "/hcm/process-monitor?organizationId=1"), 200);
  for (const path of [
    "/api/hcm/process-monitor?organizationId=1",
    "/api/hcm/org-explorer?organizationId=1",
  ]) {
    const response = await read(page, path);
    assert.equal(response.status, 200, "Enterprise HR source must remain available: " + path);
    assert.equal(response.body.tenantId, 1);
    assert.ok(response.headers?.includes("no-store"));
  }
  assert.equal(await open(page, "/hcm/org-explorer?organizationId=1"), 200);
  const permittedHistory = await read(page,
    "/api/hcm/position-history?organizationId=1&positionId=9999");
  assert.equal(permittedHistory.status, 404,
    "Authorized Enterprise HR must reach the source's own position-not-found check");
  assert.equal(permittedHistory.body?.error, "Position not found in this employer.");
  assert.equal(await open(page, "/hcm/command-center?organizationId=1"), 200);
  assert.equal(await page.locator("summary").filter({ hasText: "Advanced HCM tools" }).count(), 1,
    "Entitled Enterprise HR must discover the collapsed advanced section");
  assert.equal(await open(page, "/hcm/command-center?organizationId=2"), 200);
  assert.equal(await page.locator("summary").filter({ hasText: "Advanced HCM tools" }).count(), 0,
    "Core HR must not discover advanced paid routes");
  const defsEnterprise = await read(page,
    "/api/hcm/business-processes/definitions?organizationId=1");
  assert.equal(defsEnterprise.status, 200,
    "Active Enterprise HR can inspect versioned workflow definitions");
  assert.ok(Array.isArray(defsEnterprise.body?.definitions));
  const invalidEnterpriseWrite = await write(page,
    "/api/hcm/business-processes/definitions",
    { organizationId: 1, action: "unsupported-synthetic-qa" });
  assert.equal(invalidEnterpriseWrite.status, 400,
    "Enterprise role passes paid gate and reaches action validation, without writes");
  receipts.push("Active Enterprise HR may inspect definitions; invalid write never mutates");

  receipts.push("Active Enterprise HR sees advanced navigation; Core HR does not");

  for (const suffix of ["process-monitor", "org-explorer"]) {
    const api = await read(page, "/api/hcm/" + suffix + "?organizationId=2");
    assert.equal(api.status, 402, "Core company must not read " + suffix);
    assert.equal(api.body?.code, "HCM_ENTERPRISE_PLAN_REQUIRED");
    assert.ok(api.headers?.includes("no-store"));
    assert.ok(!JSON.stringify(api.body).includes("BetaPrivate"));
    assert.equal(await open(page, "/hcm/" + suffix + "?organizationId=2"), 404);
  }
  const coreHistory = await read(page,
    "/api/hcm/position-history?organizationId=2&positionId=9999");
  assert.equal(coreHistory.status, 402,
    "Core HR cannot bypass the org explorer paywall through position history");
  assert.equal(coreHistory.body?.code, "HCM_ENTERPRISE_PLAN_REQUIRED");
  assert.ok(coreHistory.headers?.includes("no-store"));
  const coreDefinitions = await read(page,
    "/api/hcm/business-processes/definitions?organizationId=2");
  assert.equal(coreDefinitions.status, 402,
    "Core HR cannot directly read advanced workflow definitions");
  assert.equal(coreDefinitions.body?.code, "HCM_ENTERPRISE_PLAN_REQUIRED");
  assert.ok(coreDefinitions.headers?.includes("no-store"));
  const coreInvalidWrite = await write(page,
    "/api/hcm/business-processes/definitions",
    { organizationId: 2, action: "unsupported-synthetic-qa" });
  assert.equal(coreInvalidWrite.status, 402,
    "Core HR must fail plan gate before any create/enable/disable action");
  assert.equal(coreInvalidWrite.body?.code, "HCM_ENTERPRISE_PLAN_REQUIRED");
  receipts.push("Core HR denied direct workflow definition reads and writes");

  receipts.push("Active Core denied on both pages and all three direct read APIs");

  const manager = await browser.newContext();
  await login(manager, "monitor-manager@example.test");
  const managerPage = await manager.newPage();
  await open(managerPage, "/hcm/process-monitor?organizationId=1");
  for (const suffix of ["process-monitor", "org-explorer"]) {
    const api = await read(managerPage, "/api/hcm/" + suffix + "?organizationId=1");
    assert.equal(api.status, 403, "Unauthorized manager must fail before billing: " + suffix);
    assert.ok(!JSON.stringify(api.body).includes("HCM_ENTERPRISE_PLAN_REQUIRED"));
    assert.equal(await open(managerPage, "/hcm/" + suffix + "?organizationId=1"), 404);
  }
  const managerHistory = await read(managerPage,
    "/api/hcm/position-history?organizationId=1&positionId=9999");
  assert.equal(managerHistory.status, 403,
    "Manager position-history access must fail before billing");
  const managerDefinitions = await read(managerPage,
    "/api/hcm/business-processes/definitions?organizationId=1");
  assert.equal(managerDefinitions.status, 403,
    "Manager cannot inspect Enterprise workflow designer definitions");
  const managerWrite = await write(managerPage,
    "/api/hcm/business-processes/definitions",
    { organizationId: 1, action: "unsupported-synthetic-qa" });
  assert.equal(managerWrite.status, 403,
    "Manager cannot buy their way past workflow admin authorization");
  receipts.push("Unprivileged manager cannot buy their way past existing roles");
  await manager.close();

  const unauthenticated = await browser.newContext();
  const anonymousPage = await unauthenticated.newPage();
  await anonymousPage.goto(url + "/login", { waitUntil: "domcontentloaded" });
  for (const suffix of ["process-monitor", "org-explorer"]) {
    const api = await read(anonymousPage, "/api/hcm/" + suffix + "?organizationId=1");
    assert.equal(api.status, 401, "Unauthenticated request must fail first");
  }
  const anonymousHistory = await read(anonymousPage,
    "/api/hcm/position-history?organizationId=1&positionId=9999");
  assert.equal(anonymousHistory.status, 401,
    "Anonymous position-history must fail before billing");
  const anonDefinitions = await read(anonymousPage,
    "/api/hcm/business-processes/definitions?organizationId=1");
  assert.equal(anonDefinitions.status, 401,
    "Anonymous workflow designer GET must reject before billing");
  await unauthenticated.close();
  receipts.push("Unauthenticated requests denied before billing");
  console.log(JSON.stringify({
    status: "PASS", syntheticOnly: true, directApiAndPageGate: true,
    configuredEmployers: [1, 2], receipts, liveEmployerDataAccessed: false,
    productionCertified: false, payrollReleased: false,
  }));
  await hr.close();
} finally {
  await browser.close();
}
