import assert from "node:assert/strict";
import { assertApprovalDenial, requireDisposableApprovalTask } from "./tenant-approval-task-contract.mjs";

export const APPROVAL_SOURCES_METHOD = "PATCH approvals/[id]";
export const APPROVAL_SOURCES_TITLE = "tenant-approval-sources-isolation";

/** The same disposable-target contract as the generic approval-task proof. No database or app import may precede it. */
export function requireDisposableApprovalSources(env = process.env) {
  return requireDisposableApprovalTask(env);
}

export { assertApprovalDenial };

/** An approval of a source-bound task (leave, chain step) must persist the exact own source decision. */
export function assertOwnSourceDecision(response, { id, organizationId, status, actor, leave = false, chain = false }) {
  assert.equal(response?.status, 200, "own source decision must succeed over HTTP: " + response?.text?.slice(0, 200));
  const row = response.json;
  assert.ok(row && typeof row === "object" && !Array.isArray(row), "real JSON decision required");
  assert.equal(row.id, id, "wrong task returned");
  assert.equal(row.organizationId, organizationId, "cross-employer decision returned");
  assert.equal(row.status, status, "decision did not persist expected status");
  assert.equal(row.decidedBy, actor, "wrong authenticated decision maker");
  assert.equal(row.payrollRunId, null, "this proof never approves a payroll run");
  assert.equal(row.delegation?.permitted, true, "decision must have active approver authority");
  assert.equal(row.delegation?.roleMatched, true, "actor must hold the actual employer's owner role");
  assert.equal(row.leaveUpdated, leave, "leave source linkage must match the fixture");
  assert.equal(Boolean(row.approvalChain?.isChain), chain, "chain linkage must match the fixture");
  return row;
}

/** Rows keyed by table name must be byte-identical (JSON) before and after. */
export function assertSnapshotsUnchanged(before, after, label) {
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), label + ": table set changed");
  for (const name of Object.keys(before)) {
    assert.deepEqual(after[name], before[name], label + ": " + name + " changed");
  }
}
