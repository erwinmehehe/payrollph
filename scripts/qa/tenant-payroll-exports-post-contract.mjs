import assert from "node:assert/strict";

export const EXPORTS_POST_METHOD = "POST payroll-runs/[id]/exports";
export const EXPORTS_POST_TITLE = "tenant-payroll-exports-post-isolation";

/** A refusal must carry the exact status, a JSON error and none of the forbidden victim or session markers. */
export function assertExportsDenial(response, status, forbidden, label = "refusal") {
  assert.equal(response?.status, status, label + ": incorrect refusal status: " + String(response?.text).slice(0, 300));
  assert.ok(response.json && typeof response.json.error === "string" && response.json.error.length > 0, label + ": a JSON error is required");
  const haystack = response.text + JSON.stringify(response.headers ?? []);
  for (const marker of forbidden) {
    assert.ok(typeof marker === "string" && marker.length > 0, label + ": missing forbidden marker");
    assert.ok(!haystack.includes(marker), label + ": leaked a forbidden marker");
  }
  return true;
}

/** The one synthetic batch must carry exactly the own run's single worker, amount, account and idempotency key. */
export function assertDisbursementPayload(post, { runId, employeeNo, amountCents, account }) {
  assert.ok(post && post.payload && Array.isArray(post.payload.transfers), "a recorded batch payload is required");
  assert.equal(post.idempotencyKey, "payroll-run-" + runId, "the idempotency key is bound to the own run");
  assert.equal(post.payload.transfers.length, 1, "only the own run's single worker may be paid");
  const [transfer] = post.payload.transfers;
  assert.equal(transfer.reference_number, "PAY-" + runId + "-" + employeeNo, "the transfer reference is bound to the own run and worker");
  assert.equal(transfer.amount, amountCents, "the transfer amount is the own net pay");
  assert.equal(transfer.destination_account?.number, account, "the transfer goes to the own worker's account");
  return true;
}

/** Rows keyed by table name must be byte-identical (JSON) before and after. */
export function assertRowsUnchanged(before, after, label) {
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), label + ": table set changed");
  for (const name of Object.keys(before)) assert.deepEqual(after[name], before[name], label + ": " + name + " changed");
}
