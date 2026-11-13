import assert from "node:assert/strict";
import { requireDisposablePayrollRunActions } from "./tenant-payroll-run-actions-contract.mjs";

export const CREATION_METHOD = "POST payroll-runs";
export const CREATION_RESULT = "payroll-run-creation-renewal-real-http";

export function requireCreationRenewalEnvironment(env = process.env) {
  requireDisposablePayrollRunActions(env);
  assert.equal(env.PAYROLL_RUN_RENEWAL_MODE, "fictional-pg16-real-http");
  for (const flag of ["FINAL_PAY_SIGNED_REVIEW_ENABLED", "EXACT_THIRTEENTH_CENTAVOS_ENABLED",
    "PAYROLL_CALCULATION_HISTORY_ENABLED", "NEXT_CSP_ENABLED", "FINAL_PAY_MANUAL_RELEASE_ENABLED",
    "PAYROLL_PRE_RUN_READINESS_ENABLED"])
    assert.equal(env[flag], "false", flag + " must remain OFF");
}

export function assertProcessedPayroll(response, expected) {
  assert.equal(response.status, 200, "Actual process POST must succeed: " + response.text?.slice(0, 200));
  const run = response.json?.run;
  assert.equal(run?.id, expected.id);
  assert.equal(run.organizationId, expected.organizationId);
  assert.equal(run.legalEntityId, expected.legalEntityId);
  assert.equal(run.status, "Needs review");
  assert.equal(run.employeeCount, 1);
  assert.ok(Number.isFinite(Number(run.grossPay)) && Number(run.grossPay) > 0);
  assert.ok(Number.isFinite(Number(run.netPay)) && Number(run.netPay) > 0);
  return run;
}

/** A real 201 must describe this employer's persisted draft/calculation, not a refusal or foreign row. */
export function assertCreatedPayroll(response, expected) {
  assert.equal(response.status, 201, "Payroll creation must succeed: " + response.text?.slice(0, 200));
  const run = response.json?.run;
  assert.ok(Number.isSafeInteger(run?.id) && run.id > 0);
  for (const key of ["organizationId", "legalEntityId", "periodStart", "periodEnd", "payDate"])
    assert.equal(run[key], expected[key], "Created payroll ownership/period mismatch: " + key);
  if (expected.processNow) {
    assert.equal(run.status, "Needs review", "Calculation must finish; queued/failed is not a positive");
    assert.equal(run.employeeCount, 1);
    assert.ok(Number.isFinite(Number(run.grossPay)) && Number(run.grossPay) > 0);
    assert.ok(Number.isFinite(Number(run.netPay)) && Number(run.netPay) > 0);
  } else {
    assert.equal(run.status, "Draft");
    assert.equal(response.json.queue, null);
    assert.equal(response.json.processResult, null);
  }
  return run;
}

export function assertCreationRefusal(response, status, forbidden) {
  assert.equal(response.status, status);
  assert.ok(typeof response.json?.error === "string" && response.json.error.length > 0);
  for (const marker of forbidden) {
    assert.ok(typeof marker === "string" && marker.length > 0);
    assert.ok(!response.text.includes(marker), "Creation refusal exposed a victim marker");
  }
}

export function assertCreationDiscriminates(validate, response, expected, foreign) {
  assert.equal(response.status, 201, "Discrimination requires an actual successful HTTP response");
  const foreignShaped = structuredClone(response);
  Object.assign(foreignShaped.json.run, { organizationId: foreign.organizationId, legalEntityId: foreign.legalEntityId });
  assert.throws(() => validate(foreignShaped, expected), undefined,
    "Creation validator accepts another employer's data");
}

/** Counters are necessary, not sufficient: credit additionally requires sealed executed source/job evidence. */
export function verifyCreationRenewalResult(result) {
  assert.equal(result.kind, CREATION_RESULT);
  assert.equal(result.method, CREATION_METHOD);
  assert.match(result.sourceHead, /^[a-f0-9]{40}$/);
  assert.deepEqual(result.modes, ["draft", "calculate"]);
  assert.deepEqual(result.own201, [2, 2]);
  assert.deepEqual(result.foreign403, [2, 2]);
  assert.deepEqual(result.forgedEntity422, [2, 2]);
  assert.deepEqual(result.forgedUnit400, [2, 2]);
  assert.equal(result.processOwn200, 2);
  assert.equal(result.processForeign404, 2);
  assert.equal(result.processSelectorConfined, true);
  assert.equal(result.distinctAttackerEmployers, 2);
  assert.equal(result.higherIdVictim, true);
  assert.equal(result.victimOwnPositive, true);
  assert.equal(result.persistedOwnRowsAndAudit, true);
  assert.equal(result.victimSqlUnchanged, true);
  assert.equal(result.discriminationPassed, true);
  assert.equal(result.providerCalls, 0);
  assert.equal(result.coverageCredits, 0);
  assert.equal(result.productionCertified, false);
  assert.equal(result.label, "SOLO_VERIFIED_DEV_RECOVERY");
  return true;
}
