import assert from "node:assert/strict";
import test from "node:test";
import { payrollRunPresentation } from "../src/lib/payroll-workflow-presentation";
import type { PayrollRun, Task } from "../src/components/workspace/types";
import type { PayrollPayoutState } from "../src/lib/payroll-payout-state";

const run = {
  id: 1,
  periodLabel: "October 2026",
  periodStart: "2026-10-16",
  periodEnd: "2026-10-31",
  payDate: "2026-11-05",
  scopeLabel: "All workers",
  status: "Processed",
  employeeCount: 2,
  grossPay: "1000.01",
  netPay: "750.00",
  exceptions: 0,
  ruleVersion: "synthetic",
} as PayrollRun;

// Display-only test fixture: no payout provider, payroll API or database is used.
const payout = { payout: {
  status: "awaiting-preflight", label: "No payout authorized",
} } as PayrollPayoutState;

const approved = { status: "Approved" } as Task;
const view = (data: PayrollRun, withApproval = false) =>
  payrollRunPresentation({
    run: data, payout, checklist: [],
    approvalTask: withApproval ? approved : null,
    now: new Date("2026-11-10T00:00:00Z"),
  });

test("workflow displays exact reviewed centavos for valid stored amounts", () => {
  const result = view(run);
  assert.equal(result.calculated, true);
  assert.equal(result.grossPay, 1000.01);
  assert.equal(result.netPay, 750);
  assert.equal(result.employeeDeductions, 250.01);
  assert.equal(result.currentStage, "review");
});

test("unverified gross and net amounts never look calculated", () => {
  const invalid = [
    "1e3", "1000.001", " 1000.00", "1000.00 ", "1,000.00",
    "Infinity", "NaN", "90071992547409.92", "", " ",
    "+1000.00", "01000.00", "0.001", null, undefined, true, {},
  ] as const;
  for (const value of invalid) {
    for (const field of ["grossPay", "netPay"] as const) {
      const data = { ...run, [field]: value } as unknown as PayrollRun;
      const result = view(data);
      assert.equal(result.calculated, false, field + "=" + String(value));
      assert.equal(result.grossPay, null, field);
      assert.equal(result.netPay, null, field);
      assert.equal(result.employeeDeductions, null, field);
    }
  }
});

test("approved status cannot make malformed source money appear ready for release", () => {
  const correct = view({ ...run, status: "Ready for release" }, true);
  assert.equal(correct.currentStage, "release");
  const corrupt = view({ ...run, status: "Ready for release", netPay: "750.001" }, true);
  assert.equal(corrupt.calculated, false);
  assert.notEqual(corrupt.currentStage, "release");
  assert.match(corrupt.message, /could not be verified/);
});

test("invalid net/gross centavo subtraction cannot overflow deductions", () => {
  const result = view({
    ...run,
    grossPay: "60000000000000.00",
    netPay: "-60000000000000.00",
  });
  assert.equal(result.calculated, false);
  assert.equal(result.employeeDeductions, null);
});

test("failed payroll status remains not calculated even with valid numbers", () => {
  const result = view({ ...run, status: "Failed" });
  assert.equal(result.calculated, false);
  assert.equal(result.grossPay, null);
});
