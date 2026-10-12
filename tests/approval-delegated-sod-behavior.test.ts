import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePayrollReleaseDuties } from "../src/lib/payroll-release-segregation";
import { resolveApproversFromRows } from "../src/lib/delegation";

test("delegation never permits the maker to become their own payroll checker", () => {
  const route = resolveApproversFromRows("Checker", [
    { fromApprover: "Checker", toApprover: "Maker", reason: "Cover review" },
  ]);
  // Delegation routing can nominate the maker, but immutable authenticated
  // maker/checker evidence still refuses the final payroll release.
  assert.equal(route.allowed.includes("maker"), true);
  const denied = evaluatePayrollReleaseDuties({
    organizationId: 2, payrollRunId: 7, approvalTaskId: 13,
    releaserUserId: 33, managedClientApproverUserId: null,
  }, [
    { action: "Payroll submitted for review", metadata: {
      taskId: 13, runId: 7, makerUserId: 22, approverUserId: 11,
    } },
    { action: "Approval approved by delegate", metadata: {
      taskId: 13, payrollRunId: 7, makerUserId: 22,
      approverUserId: 11, deciderUserId: 22,
    } },
  ]);
  assert.equal(denied.allowed, false);
  if (!denied.allowed) assert.equal(denied.code, "PAYROLL_RELEASE_SOD_EVIDENCE_MISSING");
});

test("release excludes the assigned checker AND actual delegate even when independent", () => {
  const events = [
    { action: "Payroll submitted for review", metadata: {
      taskId: 100, runId: 200, makerUserId: 1, approverUserId: 2,
    } },
    { action: "Approval approved by delegate", metadata: {
      taskId: 100, payrollRunId: 200, makerUserId: 1,
      approverUserId: 2, deciderUserId: 3,
    } },
  ];
  const input = {
    organizationId: 7, payrollRunId: 200, approvalTaskId: 100,
    managedClientApproverUserId: null,
  };
  const checked = evaluatePayrollReleaseDuties({ ...input, releaserUserId: 2 }, events);
  const delegated = evaluatePayrollReleaseDuties({ ...input, releaserUserId: 3 }, events);
  const independent = evaluatePayrollReleaseDuties({ ...input, releaserUserId: 4 }, events);
  assert.equal(checked.allowed, false);
  assert.equal(delegated.allowed, false);
  assert.equal(independent.allowed, true);
});
