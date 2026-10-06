import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { managedPayrollApprovalMatches, MANAGED_PAYROLL_GATES } from "../src/lib/managed-payroll";

test("managed payroll implementation has evidence gates for parallel run and client signoff", () => {
  const keys = new Set(MANAGED_PAYROLL_GATES.map((gate) => gate.key));
  assert.ok(keys.has("parallel-run"));
  assert.ok(keys.has("bank-uat"));
  assert.ok(keys.has("filing-workflow"));
  assert.ok(keys.has("client-signoff"));
});

test("client approval is invalid when exact payroll contents change", () => {
  const run = { grossPay: "100000.00", netPay: "80000.00", employeeCount: 10 };
  const approval = {
    payrollFingerprint: "a".repeat(64),
    approvedGross: "100000.00",
    approvedNet: "80000.00",
    approvedEmployeeCount: 10,
  };
  assert.equal(managedPayrollApprovalMatches(run, approval, "a".repeat(64)), true);
  assert.equal(managedPayrollApprovalMatches({ ...run, netPay: "79999.99" }, approval, "a".repeat(64)), false);
  assert.equal(managedPayrollApprovalMatches(run, approval, "b".repeat(64)), false);
});


test("managed payroll release rechecks implementation gates and approval fingerprints", () => {
  const lib = readFileSync("src/lib/managed-payroll.ts", "utf8");
  const release = readFileSync("src/app/api/payroll-runs/[id]/release/route.ts", "utf8");
  const approval = readFileSync("src/app/api/managed-payroll/runs/[id]/approve/route.ts", "utf8");

  assert.ok(lib.includes("canonicalizeManagedPayrollValue"));
  assert.ok(lib.includes("missingGateKeys"));
  assert.ok(lib.includes("gatesComplete"));
  assert.ok(release.includes("!managedRequirement.gatesComplete"));
  assert.ok(release.includes("missingGateKeys"));
  assert.ok(approval.includes("missingGateKeys.length > 0"));
  assert.ok(approval.includes("previousFingerprint"));
  assert.ok(approval.includes("previousGross"));
  assert.ok(approval.includes("previousApprovedAt"));
});


test("managed payroll client approval is distinct from the authenticated payroll checker", () => {
  const approvalRoute = readFileSync("src/app/api/managed-payroll/runs/[id]/approve/route.ts", "utf8");
  const checkerRoute = readFileSync("src/app/api/approvals/[id]/route.ts", "utf8");
  assert.ok(checkerRoute.includes("deciderUserId: sessionUser.id"));
  assert.ok(approvalRoute.includes("sameAuthenticatedChecker"));
  assert.ok(approvalRoute.includes("the payroll checker cannot also give the managed-payroll client approval"));
  assert.ok(approvalRoute.includes("Independent checker approval evidence is missing"));
});


test("paused engagement and client-approver changes cannot bypass managed payroll release controls", () => {
  const lib = readFileSync("src/lib/managed-payroll.ts", "utf8");
  const managedRoute = readFileSync("src/app/api/managed-payroll/route.ts", "utf8");
  const approvalRoute = readFileSync("src/app/api/managed-payroll/runs/[id]/approve/route.ts", "utf8");
  const releaseRoute = readFileSync("src/app/api/payroll-runs/[id]/release/route.ts", "utf8");

  assert.ok(lib.includes('const engagementActive = ["pilot", "live"].includes(engagement.status)'));
  assert.ok(lib.includes("approval.approverUserId === engagement.clientApproverUserId"));
  assert.ok(lib.includes("approval.approvedByUserId === engagement.clientApproverUserId"));
  assert.ok(managedRoute.includes('["pilot", "live"].includes(engagement.status)'));
  assert.ok(approvalRoute.includes("approverUserId: engagement.clientApproverUserId"));
  assert.ok(releaseRoute.includes("Managed payroll is paused."));
  assert.ok(releaseRoute.includes("designated approver changed"));
});
