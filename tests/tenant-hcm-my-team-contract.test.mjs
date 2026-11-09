import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import {
  ORIGIN, SOURCE_PINS, gitBlobSha, verifyMyTeamSourcePins,
  requireDisposableMyTeamEnv, assertNoMarkers, assertOwnedPage,
  assertOwnedApi, assertDenied, assertUnchangedSql,
} from "../scripts/qa/tenant-hcm-my-team-contract.mjs";

const safe = {
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
  TENANT_HCM_MY_TEAM_PROOF: "fictional-pg16-only",
  BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  APP_BASE_URL: ORIGIN, SECURITY_SMOKE_URL: ORIGIN, TRUSTED_APP_ORIGINS: ORIGIN,
  HCM_MY_TEAM_ENABLED: "true", DEMO_MODE: "false",
  REQUIRE_PRIVILEGED_MFA: "true", WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false", FINAL_PAY_SIGNED_REVIEW_ENABLED: "false",
  EXACT_THIRTEENTH_CENTAVOS_ENABLED: "false", PAYROLL_CALCULATION_HISTORY_ENABLED: "false",
};

const owner = {
  label: "ATTA", marker: "TTBL-ATTA-fixture",
  org: { id: 1 }, privateBank: "BANK-SECRET-ATTA",
  privateTax: "TAX-SECRET-ATTA",
  privateLeaveReason: "PRIVATE-LEAVE-ATTA",
};
const other = { label: "VICTIM", marker: "TTBL-VICTIM-fixture", org: { id: 3 } };
const employees = [
  { id: 51, employeeNo: "TTBL-ATTA-fixture", status: "Active" },
  { id: 55, employeeNo: "TTBL-ATTA-fixture-2", status: "Active" },
];
const scope = { kind: "company", orgUnitId: null };
const body = {
  organizationId: owner.org.id, observedAt: "2026-11-09T00:00:00.000Z",
  query: "", statusFilter: "all", scope,
  items: employees.map(x => ({
    id: x.id, employeeNo: x.employeeNo, name: "Table " + owner.marker,
    jobTitle: "Fictional", employmentType: "Regular", status: x.status,
    orgUnitName: owner.marker + " unit", orgUnitIntegrity: "verified",
    pendingLeaveRecords: 1, pendingOvertimeRecords: 0,
    pendingAttendanceCorrections: 0, incompletePunchRecords: 0,
  })),
  page: { size: 25, hasMore: false, nextCursor: null },
  summary: { employeeRecordsThisPage: 2, pendingLeaveRecordsThisPage: 2,
    pendingOvertimeRecordsThisPage: 0, pendingAttendanceCorrectionsThisPage: 0,
    incompletePunchRecordsThisPage: 0 },
};
const response = (status, payload = body, cache = "private, no-store") => ({
  status, json: payload, text: JSON.stringify(payload),
  headers: new Headers({ "cache-control": cache }),
});

test("fictional PG16-only environment rejects external providers and unsafe switches", () => {
  assert.doesNotThrow(() => requireDisposableMyTeamEnv(safe));
  for (const change of [
    { CI: "false" }, { GITHUB_ACTIONS: "false" }, { NODE_ENV: "development" },
    { TENANT_HCM_MY_TEAM_PROOF: "production" },
    { BUILD_BLOCK_ACCEPTANCE_MODE: "real" },
    { DATABASE_URL: "postgresql://db.remote.invalid/live" },
    { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/prod" },
    { APP_BASE_URL: "https://prod.invalid" }, { TRUSTED_APP_ORIGINS: "https://prod.invalid" },
    { SECURITY_SMOKE_URL: "https://prod.invalid" }, { HCM_MY_TEAM_ENABLED: "false" },
    { DEMO_MODE: "true" }, { REQUIRE_PRIVILEGED_MFA: "false" },
    { WORKER_ENABLED: "true" }, { CENTRAL_SCHEDULER_ENABLED: "true" },
    { PAYMONGO_DISBURSEMENTS_ENABLED: "true" }, { XENDIT_PAYOUTS_ENABLED: "true" },
    { XENDIT_BILLING_ENABLED: "true" }, { FINAL_PAY_SIGNED_REVIEW_ENABLED: "true" },
    { PAYMONGO_SECRET_KEY: "not-allowed" }, { OPENAI_API_KEY: "not-allowed" },
    { CRON_SECRET: "not-allowed" }, { WORKER_TOKEN: "not-allowed" },
  ]) assert.throws(() => requireDisposableMyTeamEnv({ ...safe, ...change }),
    /MY_TEAM_REFUSED/, JSON.stringify(change));
});

test("own API requires persisted employee IDs, scoped unit data, source counts and privacy", () => {
  assert.doesNotThrow(() => assertOwnedApi(response(200), owner, [other], employees, scope));
  for (const invalid of [
    response(200, { ok: true }),
    response(201, body),
    response(200, { ...body, organizationId: 3 }),
    response(200, { ...body, items: [] }),
    response(200, { ...body, scope: { kind: "unit", orgUnitId: 8 } }),
    response(200, { ...body, items: [body.items[0], { ...body.items[1], id: 888 }] }),
    response(200, { ...body, items: [
      { ...body.items[0], name: other.marker }, body.items[1],
    ] }),
    response(200, { ...body, items: [
      { ...body.items[0], pendingLeaveRecords: 0 }, body.items[1],
    ] }),
    response(200, { ...body, summary: { ...body.summary, pendingLeaveRecordsThisPage: 1 } }),
    response(200, { ...body, page: { size: 25, hasMore: true, nextCursor: 55 } }),
    response(200, { ...body, note: owner.privateBank }),
    response(200, { ...body, note: owner.privateTax }),
    response(200, { ...body, note: owner.privateLeaveReason }),
    response(200, body, "public,max-age=60"),
  ]) assert.throws(() => assertOwnedApi(invalid, owner, [other], employees, scope));
});

test("SSR requires the real own page shell, selector and zero foreign markers", () => {
  assert.doesNotThrow(() => assertOwnedPage({ status: 200,
    text: "<h1>My Team</h1><a href='?organizationId=1'>Workspace</a>" },
    owner, [other]));
  assert.throws(() => assertOwnedPage({ status: 200, text: "<h1>Home</h1>" },
    owner, [other]));
  assert.throws(() => assertOwnedPage({ status: 200,
    text: "My Team organizationId=1 " + other.marker }, owner, [other]));
});

test("negative responses require true denial and no private SQL or response evidence", () => {
  assert.doesNotThrow(() => assertDenied(response(403, { error: "Denied" }),
    403, [owner, other], "foreign"));
  assert.throws(() => assertDenied(response(200), 403, [owner, other], "fake denial"));
  assert.throws(() => assertDenied(response(403, { items: body.items }), 403,
    [owner, other], "leaked employees"));
  assert.throws(() => assertDenied(response(403, { error: other.marker }), 403,
    [owner, other], "leaked marker"));
  const escaped = { ...response(403, { error: "Denied" }),
    text: "\\u0054TBL-VICTIM-fixture" };
  assert.throws(() => assertDenied(escaped, 403, [other], "escaped marker"));
  assert.throws(() => assertNoMarkers({ text: other.marker }, [other], "direct marker"));
  const before = { employees: [{ id: 51, employer: 1 }],
    leaveRequests: [{ id: 99, status: "Pending" }], auditEvents: [] };
  assert.doesNotThrow(() => assertUnchangedSql(before, structuredClone(before), "owned GET"));
  assert.throws(() => assertUnchangedSql(before,
    { ...before, leaveRequests: [] }, "unexpected write"));
});

test("all scoped sources are exactly blob-pinned, with no loose hash matches", () => {
  assert.equal(Object.keys(SOURCE_PINS).length, 11);
  for (const sha of Object.values(SOURCE_PINS)) assert.match(sha, /^[0-9a-f]{40}$/);
  assert.equal(gitBlobSha("tenant"), "34f104e42d3d8d71271e2fdebce48d513fca39e3");
  assert.notEqual(gitBlobSha("tenant"), gitBlobSha("tenant!"));
  if (process.env.CI === "true" || existsSync("src/app/hcm/my-team/page.tsx"))
    assert.equal(verifyMyTeamSourcePins(), true);
});
