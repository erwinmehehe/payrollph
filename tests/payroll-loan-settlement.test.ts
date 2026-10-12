import test from "node:test";
import assert from "node:assert/strict";
import { settlePayrollLoanBalance } from "../src/lib/payroll-loan-settlement";

test("last payroll deduction pays principal to exact zero, not negative", () => {
  const first = settlePayrollLoanBalance({
    plannedDeduction: "333.34", remainingBalance: "1000.01", totalPaid: "0.00",
  });
  assert.deepEqual(first, {
    deduction: "333.34", remainingBalance: "666.67", totalPaid: "333.34", status: "active",
  });
  const second = settlePayrollLoanBalance({
    plannedDeduction: "333.33", remainingBalance: first.remainingBalance, totalPaid: first.totalPaid,
  });
  const last = settlePayrollLoanBalance({
    plannedDeduction: "333.34", remainingBalance: second.remainingBalance, totalPaid: second.totalPaid,
  });
  assert.deepEqual(last, {
    deduction: "333.34", remainingBalance: "0.00", totalPaid: "1000.01", status: "paid_off",
  });
});
test("a one-cent over-deduction never silently rounds down or tolerates debt", () => {
  assert.throws(() => settlePayrollLoanBalance({
    plannedDeduction: "0.02", remainingBalance: "0.01", totalPaid: "999.99",
  }), /EXCEEDS_BALANCE/);
  assert.throws(() => settlePayrollLoanBalance({
    plannedDeduction: "100.01", remainingBalance: "100.00", totalPaid: "100.00",
  }), /EXCEEDS_BALANCE/);
});
test("invalid persisted cents and unbounded totalPaid fail closed", () => {
  for (const bad of [null, "NaN", "0.001", "", "1e2", -1, 0]) {
    assert.throws(() => settlePayrollLoanBalance({
      plannedDeduction: bad, remainingBalance: "100.00", totalPaid: "0.00",
    }));
  }
  assert.throws(() => settlePayrollLoanBalance({
    plannedDeduction: "0.01", remainingBalance: "0.01",
    totalPaid: "9999999999.99",
  }), /OVERFLOW/);
});
