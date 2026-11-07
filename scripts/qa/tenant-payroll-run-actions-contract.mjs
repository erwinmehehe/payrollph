import assert from "node:assert/strict";
import { requireDisposableApprovalTask } from "./tenant-approval-task-contract.mjs";

export const PILOT_SIGNOFF_METHOD = "POST payroll-runs/[id]/pilot-signoff";
export const XENDIT_STATUS_METHOD = "GET payroll-runs/[id]/xendit-payout";
export const RUN_ACTIONS_TITLE = "tenant-payroll-run-actions-isolation";

/** Independent expected figures for the single fictional released entry the harness seeds (centavos-exact). */
export const FICTIONAL_FIGURES = Object.freeze({
  grossPay: 20000, deductions: 2000, netPay: 18000, withholdingTax: 500, statutoryContributions: 1500, payoutTotal: 18000, employeeCount: 1,
});
export const FICTIONAL_LINE_ITEMS = Object.freeze([
  { code: "BASIC", label: "Basic pay", amount: 20000 },
  { code: "WHT", label: "Withholding tax", amount: -500 },
  { code: "SSS", label: "SSS", amount: -800 },
  { code: "PHIC", label: "PhilHealth", amount: -300 },
  { code: "HDMF", label: "Pag-IBIG", amount: -400 },
]);

/** The shared disposable-target contract, plus: no payout provider may be reachable from this proof. */
export function requireDisposablePayrollRunActions(env = process.env) {
  requireDisposableApprovalTask(env);
  for (const name of ["PAYMONGO_SECRET_KEY", "PAYMONGO_WALLET_ID", "XENDIT_PAYOUT_SECRET_KEY", "XENDIT_SECRET_KEY", "RESEND_API_KEY"]) {
    if (env[name]) throw new Error("PAYROLL_RUN_ACTIONS_PROOF_REFUSED: " + name + " must be empty");
  }
  if (env.XENDIT_PAYOUTS_LIVE_APPROVED === "true" || env.PAYMONGO_DISBURSEMENTS_ENABLED === "true" || env.XENDIT_PAYOUTS_ENABLED === "true") {
    throw new Error("PAYROLL_RUN_ACTIONS_PROOF_REFUSED: payout providers must stay disabled");
  }
  return true;
}

/** A successful pilot sign-off must echo exactly the system-derived figures, the run id and an audit id. */
export function assertPilotSignedOff(response, runId, expected = FICTIONAL_FIGURES) {
  assert.equal(response?.status, 200, "pilot sign-off must answer 200: " + response?.text?.slice(0, 300));
  assert.equal(response.json?.signedOff, true);
  assert.equal(response.json.runId, runId);
  assert.ok(Number.isInteger(response.json.auditEventId) && response.json.auditEventId > 0, "an audit event must be recorded");
  assert.deepEqual(response.json.verifiedFigures, expected, "verified figures must equal the system-derived register totals");
  return response.json;
}

/** A refusal must be the expected status and leak none of the forbidden victim markers. */
export function assertRefusal(response, status, forbidden = []) {
  assert.equal(response?.status, status, "incorrect refusal status " + response?.status + ": " + response?.text?.slice(0, 300));
  const body = response.text + "\n" + [...(response.headers ?? [])].map(([name, value]) => name + ":" + value).join("\n");
  for (const marker of forbidden) {
    assert.ok(typeof marker === "string" && marker.length > 0, "missing forbidden marker");
    assert.ok(!body.includes(marker), "a forbidden victim value leaked into a response");
  }
  return response.json;
}

/** Named row sets must be identical (JSON) before and after. */
export function assertRowsUnchanged(before, after, label) {
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), label + ": table set changed");
  for (const name of Object.keys(before)) assert.deepEqual(after[name], before[name], label + ": " + name + " changed");
}
