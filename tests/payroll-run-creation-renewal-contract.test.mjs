import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertCreatedPayroll, assertProcessedPayroll, assertCreationRefusal, assertCreationDiscriminates,
  verifyCreationRenewalResult, requireCreationRenewalEnvironment } from "../scripts/qa/payroll-run-creation-renewal-contract.mjs";

const expected = { organizationId: 81, legalEntityId: 92, periodStart: "2026-10-01",
  periodEnd: "2026-10-15", payDate: "2026-10-15", processNow: false };
const response = () => ({ status: 201, json: { run: { ...expected, id: 105, status: "Draft" },
  queue: null, processResult: null } });

test("creation validation discriminates foreign employer, entity and period success-shaped rows", () => {
  assert.equal(assertCreatedPayroll(response(), expected).id, 105);
  for (const patch of [{ organizationId: 999 }, { legalEntityId: 999 }, { periodEnd: "2026-10-31" }, { id: 0 }]) {
    const foreign = response(); Object.assign(foreign.json.run, patch);
    assert.throws(() => assertCreatedPayroll(foreign, expected), undefined,
      "Creation validator accepts another employer's data or an invalid persisted row");
  }
  assert.throws(() => assertCreatedPayroll({ status: 403, json: {} }, expected));
});

test("calculation positives cannot be borrowed from a draft, queued, failed or empty result", () => {
  const calculated = response(); Object.assign(calculated.json.run,
    { status: "Needs review", employeeCount: 1, grossPay: "10000.00", netPay: "9000.00" });
  assertCreatedPayroll(calculated, { ...expected, processNow: true });
  for (const patch of [{ status: "Draft" }, { status: "Queued" }, { status: "Failed" },
    { employeeCount: 0 }, { grossPay: "NaN" }, { netPay: "0.00" }]) {
    const bad = structuredClone(calculated); Object.assign(bad.json.run, patch);
    assert.throws(() => assertCreatedPayroll(bad, { ...expected, processNow: true }));
  }
});

test("mutating creation validation into a no-op fails with the foreign-data diagnostic", () => {
  const foreign = { organizationId: 999, legalEntityId: 998 };
  assertCreationDiscriminates(assertCreatedPayroll, response(), expected, foreign);
  assert.throws(() => assertCreationDiscriminates(() => undefined, response(), expected, foreign),
    /accepts another employer's data/);
});

test("creation denials require the exact refusal and cannot expose victim markers", () => {
  const denial = { status: 403, json: { error: "Denied" }, text: '{"error":"Denied"}' };
  assertCreationRefusal(denial, 403, ["VICTIM-ONLY"]);
  assert.throws(() => assertCreationRefusal({ ...denial, status: 200 }, 403, ["VICTIM-ONLY"]));
  assert.throws(() => assertCreationRefusal({ ...denial, text: "VICTIM-ONLY" }, 403, ["VICTIM-ONLY"]));
});

test("both modes and both attackers require their own complete four-part counters", () => {
  const result = { kind: "payroll-run-creation-renewal-real-http", method: "POST payroll-runs", sourceHead: "a".repeat(40),
    modes: ["draft", "calculate"], own201: [2, 2], foreign403: [2, 2], forgedEntity422: [2, 2],
    forgedUnit400: [2, 2], processOwn200: 2, processForeign404: 2, processSelectorConfined: true,
    distinctAttackerEmployers: 2, higherIdVictim: true, victimOwnPositive: true,
    persistedOwnRowsAndAudit: true, victimSqlUnchanged: true, discriminationPassed: true,
    providerCalls: 0, coverageCredits: 0, productionCertified: false, label: "SOLO_VERIFIED_DEV_RECOVERY" };
  verifyCreationRenewalResult(result);
  for (const patch of [{ modes: ["draft"] }, { own201: [2, 0] }, { foreign403: [2, 1] },
    { forgedEntity422: [0, 2] }, { victimSqlUnchanged: false }, { discriminationPassed: false },
    { distinctAttackerEmployers: 1 }, { providerCalls: 1 }, { coverageCredits: 1 }, { processOwn200: 0 }])
    assert.throws(() => verifyCreationRenewalResult({ ...result, ...patch }));
});

test("localhost PG16 CI and disabled release/provider flags are mandatory before database imports", () => {
  const env = { GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production", DEMO_MODE: "false",
    TENANT_APPROVAL_TASK_MODE: "fictional-pg16-http", TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    PAYROLL_RUN_RENEWAL_MODE: "fictional-pg16-real-http", SECURITY_SMOKE_URL: "http://127.0.0.1:3000/",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db" };
  const flags = ["PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED", "XENDIT_BILLING_ENABLED",
    "WORKER_ENABLED", "CENTRAL_SCHEDULER_ENABLED", "FINAL_PAY_SIGNED_REVIEW_ENABLED",
    "EXACT_THIRTEENTH_CENTAVOS_ENABLED", "PAYROLL_CALCULATION_HISTORY_ENABLED", "NEXT_CSP_ENABLED",
    "FINAL_PAY_MANUAL_RELEASE_ENABLED", "PAYROLL_PRE_RUN_READINESS_ENABLED"];
  for (const flag of flags) env[flag] = "false";
  requireCreationRenewalEnvironment(env);
  for (const flag of flags) assert.throws(() => requireCreationRenewalEnvironment({ ...env, [flag]: "true" }));
  for (const patch of [{ CI: "false" }, { SECURITY_SMOKE_URL: "https://example.invalid/" },
    { DATABASE_URL: "postgresql://fictional:fictional@db.example.invalid:5432/fake" },
    { PAYMONGO_SECRET_KEY: "fictional-forbidden-key" }, { PAYROLL_RUN_RENEWAL_MODE: "" }])
    assert.throws(() => requireCreationRenewalEnvironment({ ...env, ...patch }));
  const source = readFileSync("scripts/qa/payroll-run-creation-renewal-http.mjs", "utf8");
  assert.ok(source.indexOf("requireCreationRenewalEnvironment();") < source.indexOf('import("../../src/db/index.ts")'));
});

test("process POST requires actual completed owned calculation, never the readiness refusal", () => {
  const run = { id: 105, organizationId: 81, legalEntityId: 92, status: "Needs review",
    employeeCount: 1, grossPay: "10000.00", netPay: "9000.00" };
  assertProcessedPayroll({ status: 200, json: { run } }, run);
  for (const bad of [{ status: 422, json: { error: "Readiness blocked" } },
    { status: 200, json: { run: { ...run, organizationId: 999 } } },
    { status: 200, json: { run: { ...run, status: "Failed" } } }])
    assert.throws(() => assertProcessedPayroll(bad, run));
});
