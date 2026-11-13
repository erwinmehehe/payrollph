import assert from "node:assert/strict";
import { requireDisposablePayrollRunActions } from "./tenant-payroll-run-actions-contract.mjs";

export const ORACLE_METHODS = Object.freeze([
  ["GET", "assurance"], ["GET", "close"], ["POST", "close"],
  ["GET", "connected-impact"], ["GET", "explain/WORKER"],
  ["GET", "exports?kind=journal"], ["POST", "exports"],
  ["GET", "payout-reconciliation"], ["POST", "payout-reconciliation"],
  ["POST", "pilot-signoff"], ["GET", "pre-run-readiness"],
  ["POST", "process"], ["GET", "release-checklist"], ["POST", "release"],
  ["POST", "submit-review"], ["GET", "variance"],
  ["GET", "xendit-payout"], ["POST", "xendit-payout"], ["GET", "ROOT"],
]);

export function requireOracleEnvironment(env = process.env) {
  requireDisposablePayrollRunActions(env);
  assert.equal(env.PAYROLL_CONNECTED_IMPACT_ENABLED, "true", "exercise the enabled read, not its empty OFF response");
  for (const flag of ["FINAL_PAY_SIGNED_REVIEW_ENABLED", "EXACT_THIRTEENTH_CENTAVOS_ENABLED",
    "PAYROLL_CALCULATION_HISTORY_ENABLED", "NEXT_CSP_ENABLED"])
    assert.equal(env[flag], "false", flag + " must remain OFF");
}

export function assertRunIndistinguishable(foreign, missing, markers) {
  for (const response of [foreign, missing]) {
    assert.equal(response.status, 404, "missing and foreign employer runs both require 404");
    assert.ok(response.json && typeof response.json.error === "string");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("location"), null);
    for (const marker of markers) assert.ok(!response.text.includes(marker), "private run/worker marker leaked");
  }
  assert.equal(foreign.text, missing.text, "foreign and missing error bodies must be identical");
  for (const name of ["content-type", "cache-control", "location"])
    assert.equal(foreign.headers.get(name), missing.headers.get(name), "observable denial header differs: " + name);
}
