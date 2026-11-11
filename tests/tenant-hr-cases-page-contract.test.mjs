import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import {
  ORIGIN, SOURCE_PINS, gitBlobSha, verifyHrPageSourcePins,
  requireDisposableHrPageEnv, assertNoOtherEmployerMarkers,
  assertOwnHrPage, assertOwnHrCases, assertDeniedHrResponse,
  assertReadOnlySql,
} from "../scripts/qa/tenant-hr-cases-page-contract.mjs";

const safe = {
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
  TENANT_HR_CASE_PAGE_PROOF: "fictional-pg16-only",
  BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  APP_BASE_URL: ORIGIN, SECURITY_SMOKE_URL: ORIGIN, TRUSTED_APP_ORIGINS: ORIGIN,
  EMPLOYEE_HR_CASES_ENABLED: "true", MULTI_ENTITY_ENABLED: "false",
  EMPLOYEE_DOCUMENT_VAULT_ENABLED: "false",
  DEMO_MODE: "false", REQUIRE_PRIVILEGED_MFA: "true",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false", FINAL_PAY_SIGNED_REVIEW_ENABLED: "false",
  EXACT_THIRTEENTH_CENTAVOS_ENABLED: "false",
  PAYROLL_CALCULATION_HISTORY_ENABLED: "false",
};
const a = { label: "ATTA", marker: "TTBL-ATTA-fixture",
  org: { id: 8 } };
const victim = { label: "VICTIM", marker: "TTBL-VICTIM-fixture",
  org: { id: 10 } };
const rows = [
  { id: 15, organizationId: 8, employeeId: 21,
    caseType: "general", assignedRole: "hr",
    subject: a.marker + " hr", status: "open" },
  { id: 16, organizationId: 8, employeeId: 21,
    caseType: "payslip_correction", assignedRole: "payroll",
    subject: a.marker + " payroll", status: "open" },
];
const goodPayload = {
  organizationId: a.org.id,
  cases: rows.map(row => ({
    ...row, employeeName: "Table " + a.marker,
    sla: { hoursRemaining: 22, overdue: false },
    messages: [{ id: row.id + 30, body: a.marker + " internal note" }],
  })),
};
function response(status, json = goodPayload, cache = "private, no-store") {
  return { status, json, text: JSON.stringify(json),
    headers: new Headers({ "cache-control": cache }) };
}

test("real PG16 disposable environment and external-provider lockdown are mandatory", () => {
  assert.equal(requireDisposableHrPageEnv(safe), true);
  for (const override of [
    { CI: "false" }, { GITHUB_ACTIONS: "false" }, { NODE_ENV: "development" },
    { TENANT_HR_CASE_PAGE_PROOF: "live" },
    { BUILD_BLOCK_ACCEPTANCE_MODE: "production" },
    { DATABASE_URL: "postgresql://postgres:postgres@prod.invalid:5432/app_db" },
    { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/neondb" },
    { SECURITY_SMOKE_URL: "https://production.invalid" },
    { EMPLOYEE_HR_CASES_ENABLED: "false" },
    { MULTI_ENTITY_ENABLED: "true" },
    { EMPLOYEE_DOCUMENT_VAULT_ENABLED: "true" },
    { DEMO_MODE: "true" }, { REQUIRE_PRIVILEGED_MFA: "false" },
    { WORKER_ENABLED: "true" }, { CENTRAL_SCHEDULER_ENABLED: "true" },
    { PAYMONGO_DISBURSEMENTS_ENABLED: "true" },
    { OPENAI_API_KEY: "fake" }, { S3_ACCESS_KEY_ID: "fake" },
    { R2_SECRET_ACCESS_KEY: "fake" }, { SMTP_PASSWORD: "fake" },
  ]) assert.throws(() => requireDisposableHrPageEnv({ ...safe, ...override }),
    /HR_CASE_PAGE_REFUSED/, JSON.stringify(override));
});

test("own populated staff inbox must match persisted employer, case and note sources", () => {
  assert.doesNotThrow(() => assertOwnHrCases(response(200), a, [victim], rows));
  for (const invalid of [
    response(200, { ok: true }),
    response(403),
    response(200, { ...goodPayload, organizationId: victim.org.id }),
    response(200, { ...goodPayload, cases: [] }),
    response(200, { ...goodPayload, cases: goodPayload.cases.slice(0, 1) }),
    response(200, { ...goodPayload, cases: goodPayload.cases.map((row, idx) =>
      idx ? { ...row, organizationId: victim.org.id } : row) }),
    response(200, { ...goodPayload, cases: goodPayload.cases.map((row, idx) =>
      idx ? { ...row, subject: victim.marker } : row) }),
    response(200, { ...goodPayload, cases: goodPayload.cases.map((row, idx) =>
      idx ? { ...row, messages: [] } : row) }),
    response(200, goodPayload, "public,max-age=3600"),
  ]) assert.throws(() => assertOwnHrCases(invalid, a, [victim], rows));
});

test("SSR checks real own page and foreign data absence", () => {
  assert.doesNotThrow(() => assertOwnHrPage({
    status: 200, text: "<h1>Employee HR requests</h1><a href='?organizationId=8'>Workspace</a>",
  }, a, [victim]));
  assert.throws(() => assertOwnHrPage({ status: 200, text: "" }, a, [victim]));
  assert.throws(() => assertOwnHrPage({
    status: 200, text: "Employee HR requests organizationId=8 " + victim.marker,
  }, a, [victim]));
});

test("denials reject case arrays and obfuscated victim markers", () => {
  assert.doesNotThrow(() => assertDeniedHrResponse(response(403, { error: "Denied" }),
    403, [a, victim], "foreign"));
  assert.throws(() => assertDeniedHrResponse(response(200), 403, [a, victim], "fake denial"));
  assert.throws(() => assertDeniedHrResponse(response(403, goodPayload),
    403, [a, victim], "private case data"));
  assert.throws(() => assertDeniedHrResponse(response(403, { error: victim.marker }),
    403, [a, victim], "foreign marker"));
  assert.throws(() => assertNoOtherEmployerMarkers({
    text: "\\u0054TBL-VICTIM-fixture",
  }, [victim], "escaped marker"));
});

test("reads cannot modify source or audit rows", () => {
  const before = { cases: [{ id: 15, organizationId: 8 }],
    messages: [{ id: 45 }], audit: [] };
  assert.doesNotThrow(() => assertReadOnlySql(before, structuredClone(before), "read"));
  assert.throws(() => assertReadOnlySql(before, { ...before, cases: [] }, "read"));
});

test("source pins fail closed on any drift in page, API, auth or fixture", () => {
  assert.equal(Object.keys(SOURCE_PINS).length, 10);
  for (const sha of Object.values(SOURCE_PINS)) assert.match(sha, /^[0-9a-f]{40}$/);
  assert.equal(gitBlobSha("tenant"), "34f104e42d3d8d71271e2fdebce48d513fca39e3");
  assert.notEqual(gitBlobSha("tenant"), gitBlobSha("tenant!"));
  if (process.env.CI === "true" || existsSync("src/app/hcm/hr-cases/page.tsx"))
    assert.equal(verifyHrPageSourcePins(), true);
});
