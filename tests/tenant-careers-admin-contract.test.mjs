import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  requireDisposableCareersAdminEnv, assertNoVictimLeak,
  provePublicCareersGet, assertUnchangedCareersTenant, provePublishedTransition,
} from "../scripts/qa/tenant-careers-admin-contract.mjs";

const good = {
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  APP_BASE_URL: "https://payroll.example.test", DEMO_MODE: "false",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  MULTI_ENTITY_ENABLED: "false", PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false", REQUIRE_PRIVILEGED_MFA: "true",
  RECRUITMENT_JOURNEY_UI_ENABLED: "true",
  APPLICANT_PRIVACY_CONTROLS_ENABLED: "true",
  PUBLIC_INTAKE_PROOF_ENABLED: "true",
  CAREERS_PRIVACY_NOTICE_VERSION: "fictional-2026",
  CAREERS_PRIVACY_NOTICE_URL: "https://careers.example.invalid/privacy",
};
const owner = {
  orgId: 11, orgName: "TTBL-ATTA-000 employer", marker: "TTBL-ATTA-000",
  ownerId: 21, ownerName: "TTBL-ATTA-000 owner",
  jobId: 41, jobTitle: "TTBL-ATTA-000 public fictional opening",
  closedJobId: 42, closedTitle: "TTBL-ATTA-000 restricted closed-position opening",
  department: "TTBL-ATTA-000 department",
  description: "TTBL-ATTA-000 safely fictional role description",
};
const victim = {
  marker: "TTBL-VICTIM-000", jobTitle: "TTBL-VICTIM-000 public fictional opening",
  orgName: "TTBL-VICTIM-000 employer", ownerName: "TTBL-VICTIM-000 owner",
};
const before = {
  organizations: [{ id: 11, name: owner.orgName }],
  employees: [{ id: 29, organizationId: 11 }],
  memberships: [{ id: 30, organizationId: 11 }],
  profiles: [{ id: 35, organizationId: 11 }],
  positions: [{ id: 38, organizationId: 11 }],
  requisitions: [{ id: 41, organizationId: 11 }, { id: 42, organizationId: 11 }],
  applicants: [], privacyEvidence: [], payroll: [],
  publication: [
    { id: 41, organizationId: 11, published: false },
    { id: 42, organizationId: 11, published: false },
  ],
  audit: [],
};

function response(jobs, organization = owner.orgName) {
  const json = { organization, jobs };
  return {
    status: 200, json, text: JSON.stringify(json),
    headers: new Headers({ "Cache-Control": "no-store" }),
  };
}
const publicRow = {
  id: owner.jobId, title: owner.jobTitle, department: owner.department,
  description: owner.description, employmentType: "Full-time",
};
const own = response([publicRow]);

test("guard fails closed on any unsafe or omitted configuration before DB import", () => {
  assert.doesNotThrow(() => requireDisposableCareersAdminEnv(good));
  for (const [name, value] of Object.entries(good)) {
    assert.throws(() =>
      requireDisposableCareersAdminEnv({ ...good, [name]: value === "false" ? "true" : "false" }),
      /CAREERS_ADMIN_REFUSED/, "unsafe " + name);
    assert.throws(() =>
      requireDisposableCareersAdminEnv({ ...good, [name]: undefined }),
      /CAREERS_ADMIN_REFUSED/, "missing " + name);
  }
  for (const key of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY",
    "RESEND_API_KEY", "STRIPE_SECRET_KEY", "MAILGUN_API_KEY"]) {
    assert.throws(() => requireDisposableCareersAdminEnv({ ...good, [key]: "live" }),
      /CAREERS_ADMIN_REFUSED/, "secret " + key);
  }
});

test("public positive cannot be empty, foreign, include closed jobs, or disclose salary", () => {
  assert.doesNotThrow(() => provePublicCareersGet(own, owner, true, [victim]));
  assert.doesNotThrow(() => provePublicCareersGet(response([]), owner, false, [victim]));
  assert.throws(() => provePublicCareersGet(response([]), owner, true, [victim]));
  assert.throws(() => provePublicCareersGet(own, { ...owner, jobId: 998 }, true, [victim]));
  assert.throws(() => provePublicCareersGet(own, { ...owner, orgName: "FOREIGN" }, true, [victim]));
  assert.throws(() => provePublicCareersGet(response([{
    ...publicRow, salaryMin: "25000",
  }]), owner, true, [victim]));
  assert.throws(() => provePublicCareersGet(response([
    publicRow, { ...publicRow, id: 42, title: owner.closedTitle },
  ]), owner, true, [victim]));
  assert.throws(() => provePublicCareersGet(response([
    { ...publicRow, title: victim.jobTitle },
  ]), owner, true, [victim]));
});

function modified(published) {
  const out = structuredClone(before);
  out.publication[0].published = published;
  out.audit = [{
    id: 71, organizationId: 11, actor: owner.ownerName,
    action: published ? "Careers requisition published" : "Careers requisition unpublished",
    resource: String(owner.jobId),
    metadata: { requestedByUserId: owner.ownerId, requisitionId: owner.jobId },
  }];
  return {
    result: out,
    http: { status: 200, json: { id: owner.jobId, published } },
  };
}
test("a genuine HTTP 200 must be backed by one owner-scoped update and audit", () => {
  const { result, http } = modified(true);
  assert.doesNotThrow(() => provePublishedTransition(before, result, owner, true, http));
  assert.throws(() => provePublishedTransition(before, before, owner, true, http),
    "a no-op with a fake successful HTTP body is not proof");
  const badActor = structuredClone(result);
  badActor.audit[0].actor = "FOREIGN";
  assert.throws(() => provePublishedTransition(before, badActor, owner, true, http));
  const badTenant = structuredClone(result);
  badTenant.audit[0].organizationId = 999;
  assert.throws(() => provePublishedTransition(before, badTenant, owner, true, http));
  const badOther = structuredClone(result);
  badOther.publication[1].published = true;
  assert.throws(() => provePublishedTransition(before, badOther, owner, true, http));
  const badPayroll = structuredClone(result);
  badPayroll.payroll.push({ id: 400, organizationId: 11 });
  assert.throws(() => provePublishedTransition(before, badPayroll, owner, true, http));
  const badMember = structuredClone(result);
  badMember.memberships[0].role = "owner";
  assert.throws(() => provePublishedTransition(before, badMember, owner, true, http));
  const badAudit = structuredClone(result);
  badAudit.audit = [];
  assert.throws(() => provePublishedTransition(before, badAudit, owner, true, http));
});

test("unpublishing must be the exact inverse of a real published row", () => {
  const prior = modified(true).result;
  const next = structuredClone(prior);
  next.publication[0].published = false;
  next.audit.push({
    id: 72, organizationId: 11, actor: owner.ownerName,
    action: "Careers requisition unpublished", resource: String(owner.jobId),
    metadata: { requestedByUserId: owner.ownerId, requisitionId: owner.jobId },
  });
  const http = { status: 200, json: { id: owner.jobId, published: false } };
  assert.doesNotThrow(() => provePublishedTransition(prior, next, owner, false, http));
  assert.throws(() => provePublishedTransition(before, next, owner, false, http));
  assert.doesNotThrow(() =>
    assertUnchangedCareersTenant(prior, structuredClone(prior), "denied"));
  assert.throws(() => assertUnchangedCareersTenant(prior, next, "denied"));
});

test("the exact legacy route still guards org, requisition, MFA, CAS and an atomic audit", () => {
  const route = readFileSync("src/app/api/careers/admin/route.ts", "utf8");
  const runner = readFileSync("scripts/qa/tenant-careers-admin-http.mjs", "utf8");
  assert.match(route, /assertOrganizationRole/);
  assert.match(route, /canManagePublicCareers/);
  assert.match(route, /requireSensitiveActionMfa/);
  assert.match(route, /req\.organization_id = \$\{organizationId\}/);
  assert.match(route, /req\.id = \$\{requisitionId\}/);
  assert.match(route, /req\.careers_published = \$\{body\.expectedPublished\}/);
  assert.match(route, /tx\.insert\(auditEvents\)/);
  assert.match(route, /rate\.mode !== "distributed-postgres"/);
  assert.ok(runner.indexOf("requireDisposableCareersAdminEnv();") <
    runner.indexOf('import("../../src/db/index.ts")'),
    "disposable guard must precede all application imports");
  for (const key of [
    "higher-ID target", "foreignDenials", "forgedDenials", "closedDenials",
    "ownedPublishes", "ownedUnpublishes", "staleDenials", "coverageCredits: 0",
  ]) assert.ok(runner.includes(key), "missing live contract: " + key);
  const inventory = JSON.parse(readFileSync(
    "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const record = Object.values(inventory.allApiRouteFiles)
    .find(x => x.route === "careers/admin");
  assert.equal(record?.methods?.find(x => x.name === "PATCH")?.status, "GAP",
    "incomplete proof is not method-level coverage credit");
});
test("foreign responses cannot carry any victim marker", () => {
  assert.doesNotThrow(() =>
    assertNoVictimLeak({ text: "{\"error\":\"permission denied\"}" }, victim, "foreign"));
  assert.throws(() => assertNoVictimLeak({
    text: JSON.stringify({ error: victim.ownerName }),
  }, victim, "foreign"));
});
