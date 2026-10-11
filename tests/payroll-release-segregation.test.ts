import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  evaluatePayrollReleaseDuties,
  type PayrollReleaseDutyInput,
  type PayrollReleaseDutyEvent,
} from "../src/lib/payroll-release-segregation";

const base: PayrollReleaseDutyInput = {
  organizationId: 1,
  payrollRunId: 31,
  approvalTaskId: 44,
  releaserUserId: 9,
  managedClientApproverUserId: null,
};

function evidence(
  actualCheckerId = 5,
  assignedCheckerId = 5,
  taskId = base.approvalTaskId,
  runId = base.payrollRunId,
): PayrollReleaseDutyEvent[] {
  return [
    {
      action: "Payroll submitted for review",
      metadata: { runId, taskId, makerUserId: 3, approverUserId: assignedCheckerId },
    },
    {
      action: actualCheckerId === assignedCheckerId
        ? "Approval approved"
        : "Approval approved by delegate",
      metadata: {
        payrollRunId: runId,
        taskId,
        makerUserId: 3,
        approverUserId: assignedCheckerId,
        deciderUserId: actualCheckerId,
      },
    },
  ];
}

test("a distinct authorized owner can release independently checked payroll", () => {
  const result = evaluatePayrollReleaseDuties(base, evidence());
  assert.equal(result.allowed, true);
  if (!result.allowed) return;
  assert.deepEqual(
    { maker: result.makerUserId, checker: result.checkerUserId, assigned: result.assignedCheckerUserId },
    { maker: 3, checker: 5, assigned: 5 },
  );
});

test("checker and delegated checker cannot release their own payroll, regardless of name", () => {
  for (const actualCheckerId of [5, 7]) {
    const decision = evaluatePayrollReleaseDuties(
      { ...base, releaserUserId: actualCheckerId },
      evidence(actualCheckerId, 5),
    );
    assert.equal(decision.allowed, false);
    if (!decision.allowed) {
      assert.equal(decision.status, 403);
      assert.equal(decision.code, "PAYROLL_RELEASE_SOD_CONFLICT");
    }
  }
  // Assigned checker is also disqualified if a delegate decided instead.
  assert.equal(
    evaluatePayrollReleaseDuties({ ...base, releaserUserId: 5 }, evidence(7, 5)).allowed,
    false,
  );
  assert.equal(evaluatePayrollReleaseDuties(base, evidence(7, 5)).allowed, true);
});

test("managed-payroll client approver must be distinct from both checker and releaser", () => {
  assert.equal(evaluatePayrollReleaseDuties(
    { ...base, releaserUserId: 9, managedClientApproverUserId: 9 }, evidence(),
  ).allowed, false);
  assert.equal(evaluatePayrollReleaseDuties(
    { ...base, managedClientApproverUserId: 5 }, evidence(),
  ).allowed, false);
  assert.equal(evaluatePayrollReleaseDuties(
    { ...base, managedClientApproverUserId: 7 }, evidence(),
  ).allowed, true);
});

test("missing, ambiguous, legacy and inconsistent IDs fail closed", () => {
  const canonical = evidence();
  const invalid: PayrollReleaseDutyEvent[][] = [
    [],
    [canonical[0]],
    [canonical[1]],
    [...canonical, canonical[1]],
    evidence(3, 3), // maker == checker
    evidence(5, 5, 55),
    evidence(5, 5, 44, 32),
    [{ ...canonical[0], metadata: { runId: 31, taskId: 44, makerUserId: null, approverUserId: 5 } }, canonical[1]],
    [{ ...canonical[0], metadata: { runId: 31, taskId: 44, makerUserId: 3, approverUserId: "5" } }, canonical[1]],
    [canonical[0], { ...canonical[1], metadata: { taskId: 44, payrollRunId: 31, deciderUserId: 5 } }],
    [canonical[0], { ...canonical[1], metadata: { taskId: 44, payrollRunId: 31, deciderUserId: null, makerUserId: 3, approverUserId: 5 } }],
    [canonical[0], { ...canonical[1], metadata: { taskId: 44, payrollRunId: 31, deciderUserId: 5, makerUserId: 4, approverUserId: 5 } }],
  ];
  for (const rows of invalid) {
    const verdict = evaluatePayrollReleaseDuties(base, rows);
    assert.equal(verdict.allowed, false);
    if (!verdict.allowed) {
      assert.equal(verdict.code, "PAYROLL_RELEASE_SOD_EVIDENCE_MISSING");
      assert.equal(verdict.status, 409);
    }
  }
  assert.equal(evaluatePayrollReleaseDuties(
    { ...base, managedClientApproverUserId: 0 }, canonical,
  ).allowed, false);
});

test("release API gates before claiming or settling payroll and cannot rely on opt-in policy", () => {
  const api = readFileSync("src/app/api/payroll-runs/[id]/release/route.ts", "utf8");
  const loader = readFileSync("src/lib/payroll-release-segregation.ts", "utf8");
  const guard = api.indexOf("await checkPayrollReleaseSegregation({");
  const claim = api.indexOf('.set({ status: "Releasing" })');
  const settle = api.indexOf("await settlePayrollRun(runId");
  assert.ok(guard > 0 && guard < claim && claim < settle,
    "mandatory segregation check must run before release claim and financial settlement");
  assert.match(api, /releaserUserId: user.id/);
  assert.match(api, /approvalTaskId: payrollApproval.id/);
  assert.match(api, /managedRequirement.approval\?\.approvedByUserId/);
  assert.match(loader, /eq\(auditEvents.organizationId, input.organizationId\)/);
  assert.match(loader, /PAYROLL_APPROVAL_ACTIONS/);
  assert.match(loader, /deciderUserId/);
  assert.match(loader, /makerUserId/);
  assert.match(loader, /payrollRunId/);
  assert.ok(!api.includes("PAYROLL_RELEASE_SOD_ENABLED"));
  assert.ok(!api.includes("makerCheckerPolicyEnabled"));
});
