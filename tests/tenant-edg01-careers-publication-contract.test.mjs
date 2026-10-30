import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  METHOD, PATH, requireDisposableCareersEnv,
  assertDenied, assertUnchanged, assertPublicationTransition,
} from "../scripts/qa/tenant-edg01-careers-publication-contract.mjs";

const safe = () => ({
  CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  APP_BASE_URL: "https://payroll.example.test",
  DEMO_MODE: "false", MULTI_ENTITY_ENABLED: "false",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  REQUIRE_PRIVILEGED_MFA: "true",
  RECRUITMENT_JOURNEY_UI_ENABLED: "true",
  PUBLIC_INTAKE_PROOF_ENABLED: "true",
  APPLICANT_PRIVACY_CONTROLS_ENABLED: "true",
  CAREERS_PRIVACY_NOTICE_VERSION: "2026.10-ci",
  CAREERS_PRIVACY_NOTICE_URL: "https://payroll.example.test/privacy/recruitment",
});
test("the EDG-01 runner refuses remote/production targets, payments and disabled controls", () => {
  assert.doesNotThrow(() => requireDisposableCareersEnv(safe()));
  for (const [name, value] of [
    ["CI", "false"], ["GITHUB_ACTIONS", undefined],
    ["NODE_ENV", "development"], ["TENANT_SECOND_PASS_MODE", "local"],
    ["DATABASE_URL", "postgresql://postgres:postgres@remote.example/app_db"],
    ["SECURITY_SMOKE_URL", "http://0.0.0.0:3000"],
    ["APP_BASE_URL", "https://production.example.com"],
    ["DEMO_MODE", "true"], ["MULTI_ENTITY_ENABLED", "true"],
    ["PAYMONGO_DISBURSEMENTS_ENABLED", "true"],
    ["XENDIT_PAYOUTS_ENABLED", "true"], ["WORKER_ENABLED", "true"],
    ["CENTRAL_SCHEDULER_ENABLED", "true"], ["REQUIRE_PRIVILEGED_MFA", "false"],
    ["RECRUITMENT_JOURNEY_UI_ENABLED", "false"], ["PUBLIC_INTAKE_PROOF_ENABLED", "false"],
    ["APPLICANT_PRIVACY_CONTROLS_ENABLED", "false"],
    ["CAREERS_PRIVACY_NOTICE_URL", "https://malicious.example/notice"],
    ["RESEND_API_KEY", "live"], ["PAYMONGO_SECRET_KEY", "live"],
    ["NEON_DATABASE_URL", "postgres://remote/production"],
  ]) {
    assert.throws(() => requireDisposableCareersEnv({ ...safe(), [name]: value }),
      /EDG01_CAREERS_REFUSED/, name);
  }
});

test("successful publication can only change one real job and one attributable audit", () => {
  const before = {
    jobs: [
      { id: 11, organization_id: 3, careers_published: false, title: "Own job" },
      { id: 12, organization_id: 3, careers_published: false, title: "Other job" },
    ],
    workers: [{ id: 7 }], payroll: [], audits: [],
  };
  const after = structuredClone(before);
  after.jobs[0].careers_published = true;
  after.audits = [{ id: 21, organizationId: 3, actor: "Synthetic owner",
    action: "Careers requisition published", resource: "11",
    metadata: { requestedByUserId: 9, requisitionId: 11 } }];
  const target = { organizationId: 3, requisitionId: 11,
    actorUserId: 9, actorName: "Synthetic owner", published: true };
  assert.doesNotThrow(() => assertPublicationTransition(before, after, target));
  const bad = structuredClone(after);
  bad.jobs[1].careers_published = true;
  assert.throws(() => assertPublicationTransition(before, bad, target));
  const payrollMutation = structuredClone(after);
  payrollMutation.payroll.push({ id: 1 });
  assert.throws(() => assertPublicationTransition(before, payrollMutation, target));
  const badActor = structuredClone(after);
  badActor.audits[0].actor = "Other owner";
  assert.throws(() => assertPublicationTransition(before, badActor, target));
});

test("a previously published own job can be unpublished but not silently re-published", () => {
  const before = { jobs: [{ id: 51, organization_id: 8, careers_published: true }],
    audits: [{ id: 1, organizationId: 8, actor: "Synthetic owner" }], payroll: [] };
  const after = structuredClone(before);
  after.jobs[0].careers_published = false;
  after.audits.push({ id: 2, organizationId: 8, actor: "Synthetic owner",
    action: "Careers requisition unpublished", resource: "51",
    metadata: { requestedByUserId: 6, requisitionId: 51 } });
  assert.doesNotThrow(() => assertPublicationTransition(before, after,
    { organizationId: 8, requisitionId: 51, actorUserId: 6,
      actorName: "Synthetic owner", published: false }));
});

test("foreign denials cannot leak records or alter state", () => {
  assert.doesNotThrow(() => assertDenied({ status: 403,
    text: '{"error":"Unauthorized."}', json: { error: "Unauthorized." } },
  403, ["VICTIM-MARKER"]));
  assert.throws(() => assertDenied({ status: 200,
    text: '{"published":true}', json: { published: true } }, 403));
  assert.throws(() => assertDenied({ status: 403,
    text: '{"error":"VICTIM-MARKER"}',
    json: { error: "VICTIM-MARKER" } }, 403, ["VICTIM-MARKER"]));
  assert.throws(() => assertUnchanged({ jobs: [1] }, { jobs: [2] }, "victim"));
});

test("route preserves organization+requisition CAS, MFA and company-wide scope", () => {
  const s = readFileSync("src/app/api/careers/admin/route.ts", "utf8");
  for (const token of ["workflowEntityHold()", "careersNoticeConfig()",
    "enforceSameOriginMutation(request)", "assertOrganizationRole(",
    "getAccess(", "canManagePublicCareers(access)",
    "requireSensitiveActionMfa(user)", "rateLimitDistributed(",
    'rate.mode !== "distributed-postgres"', "careersSchemaReady()",
    "req.organization_id = ${organizationId}",
    "req.careers_published = ${body.expectedPublished}",
    "p.organization_id = req.organization_id",
    "auditEvents", "Cache-Control",
  ]) assert.ok(s.includes(token), "missing source guard: " + token);
});

test("review-only proof targets exactly one GAP method and does not mutate the ledger", () => {
  assert.equal(METHOD, "PATCH /api/careers/admin");
  assert.equal(PATH, "/api/careers/admin");
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const method = manifest.allApiRouteFiles["src/app/api/careers/admin/route.ts"]
    .methods.find(m => m.name === "PATCH");
  assert.ok(method, "target method must actually exist");
  assert.equal(method.status, "GAP", "this source proof must not auto-promote tenant coverage");
});

test("isolated workflow provisions PG16, applies optional careers SQL locally and checks live HTTP", () => {
  const w = readFileSync(".github/workflows/tenant-edg01-careers-publication-http.yml", "utf8");
  const tags = ["postgres:16", "npm ci", "tenant-table-env.mjs default",
    "npm run db:push", "apply-isolated-baseline.mjs", "--migrate",
    "npm run build", "-H 127.0.0.1", "--prove", "EDG-01"];
  for (const tag of tags) assert.ok(w.includes(tag), "workflow lacks " + tag);
  assert.ok(w.indexOf("--migrate") < w.indexOf("npm run build"),
    "the unnumbered experimental column must exist before the test server builds");
});
