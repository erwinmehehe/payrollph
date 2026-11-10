import assert from "node:assert/strict";
import { assertApprovalDenial, requireDisposableApprovalTask } from "./tenant-approval-task-contract.mjs";
import { assertSnapshotsUnchanged } from "./tenant-approval-sources-contract.mjs";

export const APPROVAL_FLOWS_METHOD = "PATCH approvals/[id]";
export const APPROVAL_FLOWS_TITLE = "tenant-approval-flows-isolation";

/** The same disposable-target contract as the generic approval-task proof. No database or app import may precede it. */
export function requireDisposableApprovalFlows(env = process.env) {
  return requireDisposableApprovalTask(env);
}

export { assertApprovalDenial, assertSnapshotsUnchanged };

/**
 * An approval of a flow-bound task must persist the exact own decision and report exactly the linkage the fixture has:
 * an HCM business-process step, an approval-chain step (workforce scenario or governed handoff) or an automation gate.
 */
export function assertOwnFlowDecision(response, { id, organizationId, status, actor, hcm = false, chain = false, gate = false }) {
  assert.equal(response?.status, 200, "own flow decision must succeed over HTTP: " + response?.text?.slice(0, 200));
  const row = response.json;
  assert.ok(row && typeof row === "object" && !Array.isArray(row), "real JSON decision required");
  assert.equal(row.id, id, "wrong task returned");
  assert.equal(row.organizationId, organizationId, "cross-employer decision returned");
  assert.equal(row.status, status, "decision did not persist expected status");
  assert.equal(row.decidedBy, actor, "wrong authenticated decision maker");
  assert.equal(row.payrollRunId, null, "this proof never approves a payroll run");
  assert.equal(row.delegation?.permitted, true, "decision must have active approver authority");
  assert.equal(row.delegation?.roleMatched, true, "actor must hold the actual employer's role");
  assert.equal(row.leaveUpdated, false, "this proof never touches a leave request");
  assert.equal(Boolean(row.hcmBusinessProcess?.isHcmProcess), hcm, "HCM process linkage must match the fixture");
  assert.equal(Boolean(row.approvalChain?.isChain), chain, "chain linkage must match the fixture");
  if (gate) {
    assert.equal(row.automationGate?.status, "failed", "a declined gate must fail the employer's own waiting execution");
  }
  return row;
}
