import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  METHOD, ENDPOINT, ESTIMATE_KEYS, requireDisposableTakeHome,
  assertOwnTakeHome, assertPrivateDenial, assertUnchanged,
} from "../scripts/qa/tenant-self-take-home-contract.mjs";

const safe = {
  CI: "true", NODE_ENV: "production",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  TENANT_SELF_TAKE_HOME_MODE: "fictional-read-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
  HCM_OVERPAYMENT_PREVIEW_ENABLED: "false",
  PAYROLL_OVERPAYMENT_REVIEW_ENABLED: "false",
  WORKER_TOKEN: "ci-worker-token-fictional-proof",
};
test("strict preflight refuses any hosted, payout-enabled, or non-disposable target", () => {
  assert.doesNotThrow(() => requireDisposableTakeHome(safe, "seed"));
  assert.doesNotThrow(() => requireDisposableTakeHome(safe, "prove"));
  const unsafe = [
    { CI: "false" }, { NODE_ENV: "development" }, { TENANT_SECOND_PASS_MODE: "" },
    { TENANT_SELF_TAKE_HOME_MODE: "" },
    { DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/app_db" },
    { DATABASE_URL: "postgresql://postgres:postgres@prod.local:5432/app_db" },
    { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/production" },
    { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db?ssl=true" },
    { DATABASE_URL: "postgresql://other:postgres@127.0.0.1:5432/app_db" },
    { SECURITY_SMOKE_URL: "https://payroll.example.test/" },
    { SECURITY_SMOKE_URL: "http://localhost:3000" },
    { SECURITY_SMOKE_URL: "http://127.0.0.1:3000/other" },
    { WORKER_ENABLED: "true" }, { CENTRAL_SCHEDULER_ENABLED: "true" },
    { PAYMONGO_DISBURSEMENTS_ENABLED: "true" },
    { XENDIT_PAYOUTS_ENABLED: "true" }, { XENDIT_BILLING_ENABLED: "true" },
    { HCM_OVERPAYMENT_PREVIEW_ENABLED: "true" },
    { PAYROLL_OVERPAYMENT_REVIEW_ENABLED: "true" },
    { PAYMONGO_SECRET_KEY: "secret" }, { XENDIT_SECRET_KEY: "secret" },
    { XENDIT_PAYOUT_SECRET_KEY: "secret" },
    { RESEND_API_KEY: "secret" }, { STRIPE_SECRET_KEY: "secret" },
    { WORKER_TOKEN: "" },
  ];
  for (const item of unsafe) {
    assert.throws(() => requireDisposableTakeHome({ ...safe, ...item }, "prove"),
      /TAKE_HOME_REFUSED/, "must fail before DB import: " + JSON.stringify(item));
  }
  assert.throws(() => requireDisposableTakeHome(safe, "publish"), /TAKE_HOME_REFUSED/);
});

const a = { monthlyBasic: 15840, payBasis: "daily", mwe: true };
const b = { monthlyBasic: 66000, payBasis: "hourly", mwe: false };
const today = "2026-10-27";
const sampleEstimate = {
  monthlyBasic: 15840, taxableAllowances: 0,
  nonTaxableAllowances: 0, gross: 15840,
  sss: 600, philHealth: 200, pagIbig: 100, voluntaryPagIbig: 0,
  taxableCompensation: 14940, withholdingTax: 100,
  totalDeductions: 1000, netPay: 14840,
};
function validResponse() {
  const json = {
    asOf: today, baseline: { ...a }, estimate: { ...sampleEstimate },
    note: "Estimate only. Your released payslip is the official amount.",
  };
  return {
    status: 200, json, text: JSON.stringify(json),
    headers: new Headers({ "Cache-Control": "no-store, private" }),
  };
}
const altered = mutate => {
  const r = validResponse();
  mutate(r);
  return r;
};
test("exact own pay projection has nonempty distinct source fields and privacy headers", () => {
  const r = validResponse();
  assert.equal(METHOD, "GET self/take-home-estimate");
  assert.equal(ENDPOINT, "/api/self/take-home-estimate");
  assert.equal(ESTIMATE_KEYS.length, 12);
  assert.deepEqual(assertOwnTakeHome(r, a), r.json);
  assert.throws(() => assertOwnTakeHome(r, b), /independent source profile/);
  assert.throws(() => assertOwnTakeHome(r, { ...a, mwe: false }));
  assert.throws(() => assertOwnTakeHome(r, { ...a, monthlyBasic: 97300 }));
});
test("pure checks reject empty, swapped, extra or incomplete private pay envelopes", () => {
  const mutations = [
    r => { r.status = 206; },
    r => { r.json.baseline.monthlyBasic = 66000; },
    r => { r.json.baseline.payBasis = "hourly"; },
    r => { r.json.baseline.mwe = false; },
    r => { r.json.baseline.employeeId = 44; },
    r => { r.json.bankAccount = "private"; },
    r => { r.json.estimate.employeeId = 44; },
    r => { delete r.json.estimate.netPay; },
    r => { r.json.estimate.gross = Infinity; },
    r => { r.json.estimate.gross += 1; },
    r => { r.json.estimate.sss += 1; },
    r => { r.json.estimate.netPay += 1; },
    r => { r.json.estimate.taxableAllowances = 300; },
    r => { r.json.asOf = "2026-02-30"; },
    r => { r.json.asOf = "2026/10/27"; },
    r => { r.json.note = "Guaranteed payroll amount"; },
    r => { r.json = { baseline: r.json.baseline, estimate: r.json.estimate }; },
  ];
  for (const mutation of mutations) {
    const r = altered(mutation);
    assert.throws(() => assertOwnTakeHome(r, a));
  }
});
test("sensitive successful responses cannot be public or shared-cacheable", () => {
  for (const cache of ["public, max-age=300", "private, max-age=60",
    "private, no-cache", "public, no-store", "no-store, s-maxage=300", ""]) {
    assert.throws(() => assertOwnTakeHome(altered(r => {
      r.headers = new Headers({ "Cache-Control": cache });
    }), a), "should reject " + cache);
  }
  assert.doesNotThrow(() => assertOwnTakeHome(altered(r => {
    r.headers = new Headers({ "Cache-Control": "no-store, max-age=0" });
  }), a), "semantically equivalent no-store directives are allowed");
});
test("real denied requests never report another worker's pay or identities", () => {
  const r = { status: 403, json: { error: "Forbidden." },
    text: '{"error":"Forbidden."}' };
  assert.doesNotThrow(() => assertPrivateDenial(r, 403, ["TTBL-VICTIM"]));
  assert.throws(() => assertPrivateDenial(r, 401, []));
  assert.throws(() => assertPrivateDenial({
    ...r, text: "TTBL-VICTIM private employee",
  }, 403, ["TTBL-VICTIM"]));
  assert.throws(() => assertPrivateDenial({
    ...r, json: { error: "Forbidden.", estimate: { netPay: 1 } },
  }, 403, []));
  assert.throws(() => assertPrivateDenial({
    ...r, json: { baseline: { monthlyBasic: 15840 } },
  }, 403, []));
});
test("victim snapshot comparison is strict for pay, worker, audit and payroll fields", () => {
  const state = { employees: [{ id: 31, basicRate: "20000.00" }],
    payProfiles: [{ id: 61, rateAmount: "720.00" }],
    payroll: [], audit: [], memberships: [{ active: true }] };
  assert.doesNotThrow(() => assertUnchanged(state, structuredClone(state), "victim"));
  const changed = structuredClone(state);
  changed.payProfiles[0].rateAmount = "99999.00";
  assert.throws(() => assertUnchanged(state, changed, "victim"));
});
test("route remains employee-session-only and never selects arbitrary employee selectors", () => {
  const route = readFileSync("src/app/api/self/take-home-estimate/route.ts", "utf8");
  for (const clause of [
    "export async function GET()",
    "getSessionUser()",
    'session.role !== "employee"',
    "session.employeeId",
    "assertMembership(session.id, employee.organizationId)",
    "eq(employeePayProfiles.employeeId, employee.id)",
    "resolvePayProfile(",
    "estimateMonthlyTakeHome(",
    '"Cache-Control": "no-store, private"',
  ]) assert.ok(route.includes(clause), "scoping guard changed: " + clause);
  const manifest = JSON.parse(readFileSync(
    "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const source = manifest.allApiRouteFiles["src/app/api/self/take-home-estimate/route.ts"];
  assert.equal(source.methods.find(m => m.name === "GET")?.status, "GAP",
    "synthetic QA source work does not grant any method-level coverage credit");
});
test("runner must enforce disposable guard before any application or database import", () => {
  const source = readFileSync("scripts/qa/tenant-self-take-home-http.mjs", "utf8");
  const guard = source.indexOf("requireDisposableTakeHome(process.env, stage);");
  const dbImport = source.indexOf('import("../../src/db/index.ts")');
  assert.ok(guard >= 0 && dbImport > guard, "guard must precede DB and app imports");
  assert.ok(source.includes('const stage = process.argv[2]'));
});
