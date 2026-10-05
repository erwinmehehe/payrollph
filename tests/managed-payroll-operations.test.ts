import assert from "node:assert/strict";
import test from "node:test";
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
