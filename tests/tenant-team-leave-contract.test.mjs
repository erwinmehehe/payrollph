import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import {
  ORIGIN, SOURCE_PINS, gitBlobSha, verifyTeamLeaveSourcePins,
  requireDisposableTeamLeaveEnv, assertDeniedResponse,
  assertOwnPage, assertOwnLeaveResponse, assertReadOnlySql,
} from "../scripts/qa/tenant-team-leave-contract.mjs";

const safe = {
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
  TENANT_TEAM_LEAVE_PROOF: "fictional-pg16-only",
  BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  APP_BASE_URL: ORIGIN, SECURITY_SMOKE_URL: ORIGIN, TRUSTED_APP_ORIGINS: ORIGIN,
  DEMO_MODE: "false", REQUIRE_PRIVILEGED_MFA: "true",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  HCM_TEAM_LEAVE_CALENDAR_ENABLED: "true", HCM_TEAM_LEAVE_CALENDAR_ORG_IDS: "1,2,3",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false", FINAL_PAY_SIGNED_REVIEW_ENABLED: "false",
  EXACT_THIRTEENTH_CENTAVOS_ENABLED: "false", PAYROLL_CALCULATION_HISTORY_ENABLED: "false",
};
const a = { label: "ATTA", marker: "TTBL-ATTA-test", privateReason: "PRIVATE-REASON-ATTA",
  privateType: "PRIVATE-TYPE-ATTA", org: { id: 1 } };
const b = { label: "VICTIM", marker: "TTBL-VICTIM-test", org: { id: 3 } };
const cases = [
  { id: 20, employeeId: 100, status: "Pending" },
  { id: 21, employeeId: 101, status: "Approved" },
];
const payload = {
  organizationId: 1, month: "2026-11", scope: { kind: "company", orgUnitId: null },
  dates: { start: "2026-11-01", end: "2026-11-30" },
  cases: cases.map(c => ({ requestId: c.id, employeeId: c.employeeId,
    status: c.status, employeeName: "Fictional " + a.marker })),
  summary: { approvedRequestRecords: 1, pendingRequestRecords: 1 },
};
const json = (code, data = payload, cache = "private, no-store") => ({
  status: code, json: data, text: JSON.stringify(data),
  headers: new Headers({ "cache-control": cache }),
});

test("only an explicit synthetic PG16 profile with bounded feature allowlist may run", () => {
  assert.doesNotThrow(() => requireDisposableTeamLeaveEnv(safe));
  for (const change of [
    { GITHUB_ACTIONS: "false" }, { CI: "false" }, { NODE_ENV: "development" },
    { TENANT_TEAM_LEAVE_PROOF: "live" },
    { BUILD_BLOCK_ACCEPTANCE_MODE: "production" },
    { DATABASE_URL: "postgresql://postgres@prod.invalid/company" },
    { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/production" },
    { APP_BASE_URL: "https://prod.invalid" },
    { TRUSTED_APP_ORIGINS: "https://prod.invalid" },
    { SECURITY_SMOKE_URL: "https://prod.invalid" },
    { HCM_TEAM_LEAVE_CALENDAR_ENABLED: "false" },
    { HCM_TEAM_LEAVE_CALENDAR_ORG_IDS: "1,2,3,4" },
    { HCM_TEAM_LEAVE_CALENDAR_ORG_IDS: "" },
    { WORKER_ENABLED: "true" }, { CENTRAL_SCHEDULER_ENABLED: "true" },
    { PAYMONGO_DISBURSEMENTS_ENABLED: "true" },
    { XENDIT_PAYOUTS_ENABLED: "true" }, { DEMO_MODE: "true" },
    { REQUIRE_PRIVILEGED_MFA: "false" },
    { OPENAI_API_KEY: "fake" }, { WORKER_TOKEN: "fake" },
    { PAYMONGO_SECRET_KEY: "fake" }, { SMTP_PASSWORD: "fake" },
  ]) assert.throws(() => requireDisposableTeamLeaveEnv({ ...safe, ...change }),
    /TEAM_LEAVE_REFUSED/, JSON.stringify(change));
});

test("a populated own-employer read needs exact source IDs, scope and no private reasons", () => {
  assert.doesNotThrow(() => assertOwnLeaveResponse(json(200), a, [b], cases,
    { kind: "company", orgUnitId: null }, "2026-11"));
  for (const invalid of [
    json(200, { ok: true }),
    json(403),
    json(200, { ...payload, organizationId: 3 }),
    json(200, { ...payload, cases: [] }),
    json(200, { ...payload, scope: { kind: "unit", orgUnitId: 2 } }),
    json(200, { ...payload, cases: [{ ...payload.cases[0], requestId: 999 }, payload.cases[1]] }),
    json(200, { ...payload, cases: [{ ...payload.cases[0], employeeName: b.marker }, payload.cases[1]] }),
    json(200, { ...payload, summary: { approvedRequestRecords: 0, pendingRequestRecords: 2 } }),
    json(200, { ...payload, privateReason: a.privateReason }),
    json(200, payload, "public,max-age=600"),
  ]) assert.throws(() => assertOwnLeaveResponse(invalid, a, [b], cases,
    { kind: "company", orgUnitId: null }, "2026-11"));
});

test("denials cannot expose another employer even in escaped HTTP bodies", () => {
  assert.doesNotThrow(() => assertDeniedResponse(json(403, { error: "Denied" }),
    403, [a, b], "foreign employer"));
  assert.throws(() => assertDeniedResponse(json(200), 403, [b], "fake denial"));
  assert.throws(() => assertDeniedResponse(json(403, { cases: payload.cases }),
    403, [b], "private records"));
  assert.throws(() => assertDeniedResponse(json(403, { error: b.marker }),
    403, [a, b], "private marker"));
  assert.throws(() => assertDeniedResponse({ ...json(403, { error: "Denied" }),
    text: "\\u0054TBL-VICTIM-test" }, 403, [b], "escaped marker"));
});

test("SSR own page must render and read-only SQL cannot change", () => {
  assert.doesNotThrow(() => assertOwnPage({ status: 200,
    text: "<h1>Team Leave Calendar</h1><a href=\"?organizationId=1\">Workspace</a>" }, a, [b]));
  assert.throws(() => assertOwnPage({ status: 200, text: "" }, a, [b]));
  assert.throws(() => assertOwnPage({ status: 200,
    text: "Team Leave Calendar organizationId=1 " + b.marker }, a, [b]));
  const old = { organizations: [{ id: 1 }], leaveRequests: [{ id: 20, status: "Pending" }] };
  assert.doesNotThrow(() => assertReadOnlySql(old, structuredClone(old), "legitimate GET"));
  assert.throws(() => assertReadOnlySql(old, { ...old, leaveRequests: [] }, "foreign GET"));
});

test("all page/API/SQL/authorization sources use exact reviewed Git blob pins", () => {
  assert.equal(Object.keys(SOURCE_PINS).length, 9);
  for (const sha of Object.values(SOURCE_PINS)) assert.match(sha, /^[0-9a-f]{40}$/);
  assert.equal(gitBlobSha("tenant"), "34f104e42d3d8d71271e2fdebce48d513fca39e3");
  assert.notEqual(gitBlobSha("tenant"), gitBlobSha("tenant!"));
  // The actual checkout always contains the source. Local contract-only
  // development can run without cloning a real repository, but CI cannot.
  if (process.env.CI === "true" || existsSync("src/app/hcm/team-leave-calendar/page.tsx"))
    assert.equal(verifyTeamLeaveSourcePins(), true);
});
