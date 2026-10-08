import assert from "node:assert/strict";
import test from "node:test";
import { payrollApprovalSnapshotMatches } from "../src/lib/payroll-approval-integrity";

const run = {
  id: 42,
  grossPay: "100000.00",
  netPay: "82000.00",
  employeeCount: 5,
};

const approval = {
  payrollRunId: 42,
  payrollFingerprint: "abc123",
  payrollGross: "100000.00",
  payrollNet: "82000.00",
  payrollEmployeeCount: 5,
};

test("payroll approval snapshot matches only the exact linked payroll state", () => {
  assert.equal(payrollApprovalSnapshotMatches(run, approval, "abc123"), true);
  assert.equal(payrollApprovalSnapshotMatches(run, { ...approval, payrollRunId: 43 }, "abc123"), false);
  assert.equal(payrollApprovalSnapshotMatches(run, approval, "changed"), false);
  assert.equal(payrollApprovalSnapshotMatches(run, { ...approval, payrollGross: "100000.01" }, "abc123"), false);
  assert.equal(payrollApprovalSnapshotMatches(run, { ...approval, payrollNet: "81999.99" }, "abc123"), false);
  assert.equal(payrollApprovalSnapshotMatches(run, { ...approval, payrollEmployeeCount: 6 }, "abc123"), false);
});

test("legacy approval without a payroll fingerprint never passes snapshot validation", () => {
  assert.equal(payrollApprovalSnapshotMatches(run, { ...approval, payrollFingerprint: null }, "abc123"), false);
});
