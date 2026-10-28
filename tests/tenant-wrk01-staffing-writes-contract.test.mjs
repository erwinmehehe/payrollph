import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  STAFFING_ENDPOINT, STAFFING_WRITE_METHODS,
  requireDisposableStaffingWrites, assertStaffingDenied,
  assertStaffingWrite, assertImmutableStaffingSql,
} from "../scripts/qa/tenant-wrk01-staffing-writes-contract.mjs";

const safe = {
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  TENANT_TABLE_PROFILE: "allowlisted-reads",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  TRUSTED_APP_ORIGINS: "http://127.0.0.1:3000",
  APP_BASE_URL: "https://payroll.example.test",
  DEMO_MODE: "false", REQUIRE_PRIVILEGED_MFA: "true",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  HCM_OVERPAYMENT_PREVIEW_ENABLED: "false",
  PAYROLL_OVERPAYMENT_REVIEW_ENABLED: "false",
  WFM_OPERATIONAL_DEMAND_ENABLED: "true",
  WFM_ISSUED_DEMAND_FORECASTS_ENABLED: "true",
  WFM_DEMAND_STAFFING_POLICIES_ENABLED: "true",
  TENANT_TABLE_ALLOWLIST_FIXTURE:
    "/tmp/payrollph-tenant-allowlist-Abc123/fixture.json",
  WFM_OPERATIONAL_DEMAND_ALLOWED_ORGANIZATION_IDS: "1,2,3",
  WFM_ISSUED_DEMAND_FORECASTS_ALLOWED_ORGANIZATION_IDS: "1,2,3",
  WFM_DEMAND_STAFFING_POLICIES_ALLOWED_ORGANIZATION_IDS: "1,2,3",
};
const fakeRow = () => ({
  id: 23, organizationId: 1, worksiteId: 15,
  jobProfileId: 25, version: 1, status: "draft",
  proposedByUserId: 33, decidedByUserId: null,
  contentSha256: "a".repeat(64),
});
const post = () => {
  const json = {
    id: 23, version: 1, status: "draft", replayed: false,
    contentSha256: "a".repeat(64), readOnlyProposal: true,
    boundary: "Creating this proposal does not approve staffing rules, shifts or payroll.",
  };
  return { status: 201, json, text: JSON.stringify(json),
    headers: new Headers({ "Cache-Control": "no-store, max-age=0" }) };
};
const patch = () => {
  const json = {
    id: 23, status: "approved", version: 1,
    contentSha256: "a".repeat(64),
    approvalReceiptSha256: "b".repeat(64),
    supersededPolicyId: null,
    boundary: "Approval authorizes an effective-dated planning rule only; never schedules or payroll.",
  };
  return { status: 200, json, text: JSON.stringify(json),
    headers: new Headers({ "Cache-Control": "private, no-store" }) };
};
const postProof = x => assertStaffingWrite(x, fakeRow(), {
  status: 201, policyStatus: "draft", kind: "POST", actorId: 33,
  foreignMarkers: ["TTBL-VICTIM-SECRET"],
});
const approvalProof = x => assertStaffingWrite(x,
  { ...fakeRow(), status: "approved", decidedByUserId: 44 }, {
    status: 200, policyStatus: "approved", kind: "PATCH",
    actorId: 44, foreignMarkers: ["TTBL-VICTIM-SECRET"],
  });

test("strict PG16/localhost/workers-off/provider-off source gate fails closed before DB imports", () => {
  assert.doesNotThrow(() => requireDisposableStaffingWrites(safe));
  for (const changed of [
    { GITHUB_ACTIONS: "false" }, { CI: "false" },
    { NODE_ENV: "development" }, { TENANT_SECOND_PASS_MODE: "off" },
    { DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/app_db" },
    { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db?sslmode=require" },
    { SECURITY_SMOKE_URL: "https://payrollph.example.test" },
    { APP_BASE_URL: "https://payrollph.com" },
    { TRUSTED_APP_ORIGINS: "http://localhost:3000" },
    { TENANT_TABLE_PROFILE: "default" },
    { TENANT_TABLE_ALLOWLIST_FIXTURE: "/tmp/live-worker.json" },
    { WFM_DEMAND_STAFFING_POLICIES_ENABLED: "false" },
    { WFM_OPERATIONAL_DEMAND_ALLOWED_ORGANIZATION_IDS: "1,2,4" },
    { PAYMONGO_DISBURSEMENTS_ENABLED: "true" },
    { XENDIT_BILLING_ENABLED: "true" },
    { WORKER_ENABLED: "true" }, { CENTRAL_SCHEDULER_ENABLED: "true" },
    { REQUIRE_PRIVILEGED_MFA: "false" },
    { RESEND_API_KEY: "live" }, { PAYMONGO_SECRET_KEY: "live" },
    { RESEND_WEBHOOK_SECRET: "live" },
  ]) {
    assert.throws(() => requireDisposableStaffingWrites({ ...safe, ...changed }),
      undefined, JSON.stringify(changed));
  }
});

test("real own POST must bind returned ID/hash to SQL, reject placebo success and private leaks", () => {
  postProof(post());
  for (const mutate of [
    x => { x.status = 200; },
    x => { x.status = 404; },
    x => { x.json.id = 999; },
    x => { x.json.contentSha256 = "b".repeat(64); },
    x => { x.json.status = "approved"; },
    x => { x.json.replayed = true; },
    x => { x.json.readOnlyProposal = false; },
    x => { x.json.version = 2; },
    x => { x.headers.delete("cache-control"); },
    x => { x.headers.set("cache-control", "public, no-store"); },
    x => { x.headers.set("cache-control", "no-store, max-age=300"); },
    x => { x.headers.set("x-debug", "TTBL-VICTIM-SECRET"); },
    x => { x.text += "TTBL-VICTIM-SECRET"; },
  ]) {
    const response = post();
    mutate(response);
    assert.throws(() => postProof(response));
  }
  assert.throws(() => assertStaffingWrite(post(), fakeRow(), {
    status: 201, policyStatus: "draft", kind: "POST", actorId: 99,
  }));
});

test("PATCH approvals must be actor-specific, non-cacheable, and receipt-bound", () => {
  approvalProof(patch());
  for (const mutate of [
    x => { x.status = 201; },
    x => { x.json.id = 99; },
    x => { x.json.status = "rejected"; },
    x => { x.json.contentSha256 = "c".repeat(64); },
    x => { x.json.approvalReceiptSha256 = null; },
    x => { x.headers.set("cache-control", "public, max-age=120"); },
    x => { x.text += "TTBL-VICTIM-SECRET"; },
  ]) {
    const response = patch();
    mutate(response);
    assert.throws(() => approvalProof(response));
  }
  assert.throws(() => assertStaffingWrite(patch(),
    { ...fakeRow(), status: "approved", decidedByUserId: 99 }, {
      status: 200, policyStatus: "approved", kind: "PATCH", actorId: 44,
    }));
});

test("foreign denial and real PostgreSQL immutability assertions detect accidental writes", () => {
  const denied = { status: 403, json: { error: "No company-wide People access." },
    text: "{\"error\":\"No company-wide People access.\"}", headers: new Headers() };
  assertStaffingDenied(denied, 403, ["TTBL-VICTIM-SECRET"]);
  for (const mutation of [
    { ...denied, status: 200 },
    { ...denied, json: { id: 1, error: "Denied" } },
    { ...denied, json: { error: "Denied", contentSha256: "a".repeat(64) } },
    { ...denied, text: denied.text + "TTBL-VICTIM-SECRET" },
  ]) assert.throws(() => assertStaffingDenied(mutation, 403,
    ["TTBL-VICTIM-SECRET"]));
  assertImmutableStaffingSql({ policies: [1], audit: [] },
    { policies: [1], audit: [] }, "victim");
  assert.throws(() => assertImmutableStaffingSql(
    { policies: [1], audit: [] }, { policies: [1, 2], audit: [] }, "victim"));
});

test("manifest keeps both WRK-01 write methods GAP without invented exact-head credits", () => {
  assert.deepEqual(STAFFING_WRITE_METHODS, [
    "POST workforce/demand-staffing/policies",
    "PATCH workforce/demand-staffing/policies",
  ]);
  assert.equal(STAFFING_ENDPOINT, "/api/workforce/demand-staffing/policies");
  const manifest = JSON.parse(readFileSync(
    "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const route = manifest.allApiRouteFiles[
    "src/app/api/workforce/demand-staffing/policies/route.ts"];
  assert.equal(route.route, "workforce/demand-staffing/policies");
  for (const name of ["POST", "PATCH"]) {
    const method = route.methods.find(x => x.name === name);
    assert.equal(method.status, "GAP");
    assert.equal(method.testedBy, null);
  }
});

test("actual HTTP source covers creation, all PATCH decisions, real target IDs and SQL snapshots", () => {
  const code = readFileSync("scripts/qa/tenant-wrk01-staffing-writes-http.mjs", "utf8");
  const workflow = readFileSync(".github/workflows/tenant-wrk01-staffing-writes-http.yml", "utf8");
  const route = readFileSync("src/app/api/workforce/demand-staffing/policies/route.ts", "utf8");
  const server = readFileSync("src/lib/workforce-demand-staffing-policy-server.ts", "utf8");
  const guardAt = code.indexOf("requireDisposableStaffingWrites();");
  const importAt = code.indexOf('import("../../src/db/index.ts")');
  assert.ok(guardAt >= 0 && guardAt < importAt,
    "test runner MUST refuse non-disposable execution before database imports");
  for (const marker of [
    "readAllowlistPreseed", "seedEmployerEvidence", "victim.approve.row.id",
    "assertStaffingDenied", "unchangedEverywhere", "assertStaffingWrite",
    "standaloneMakeSession", "freezeAll", "original",
    '"POST"', '"PATCH"', '"approve"', '"reject"', '"submit"',
    "other.checker.cookie", "active: false", "a.cookie",
    "workforceDemandStaffingPolicyEvents", "auditEvents", "payrollEntries",
  ]) {
    if (marker !== "original") assert.ok(code.includes(marker), marker);
  }
  for (const marker of [
    "assertImmutableStaffingSql", "assertNoForeignPolicy",
    "contentSha256", "approvalReceiptSha256",
  ]) assert.ok(code.includes(marker), marker);
  for (const marker of [
    "postgres:16", "tenant-table-env.mjs allowlisted-reads",
    "tenant-table-allowlist-bootstrap.mjs",
    "npm run db:push", "apply-isolated-baseline.mjs",
    "node --test tests/tenant-wrk01-staffing-writes-contract.test.mjs",
    "node --import tsx scripts/qa/tenant-wrk01-staffing-writes-http.mjs",
  ]) assert.ok(workflow.includes(marker), marker);
  for (const marker of [
    "enforceSameOriginMutation", "getSessionUser", "getAccess",
    "requireSensitiveActionMfa", "createStaffingPolicyDraft",
    "transitionStaffingPolicy", "parseStaffingPolicyDraft",
    "parseStaffingPolicyTransition",
  ]) assert.ok(route.includes(marker), marker);
  for (const marker of [
    "lockOrganization", "ensureScope", "eq(workforceDemandStaffingPolicies.organizationId",
    "addEvent(tx", "priorRequest", "row.proposedByUserId===actorUserId",
    "row.submittedByUserId===actorUserId", "tx.insert(workforceDemandStaffingPolicies)",
  ]) assert.ok(server.includes(marker), marker);
});
