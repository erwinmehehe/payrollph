import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { validPayrollLoanSchedule } from "../src/lib/payroll-loan-approval";

test("legacy payroll loan schedules must be positive, finite and centavo-exact", () => {
  assert.equal(validPayrollLoanSchedule({ cutoffDeduction: 500, remainingBalance: 1000 }), true);
  assert.equal(validPayrollLoanSchedule({ cutoffDeduction: 0.01, remainingBalance: 0.01 }), true);
  for (const bad of [0, -1, NaN, Infinity, 100000000, 0.001, 50.234]) {
    assert.equal(validPayrollLoanSchedule({ cutoffDeduction: bad, remainingBalance: 1000 }), false);
  }
  for (const bad of [0, -1, NaN, Infinity, 0.001]) {
    assert.equal(validPayrollLoanSchedule({ cutoffDeduction: 500, remainingBalance: bad }), false);
  }
});

test("gross-to-net engine excludes malformed legacy loans before requested deduction is calculated", () => {
  const engine = readFileSync("src/lib/payroll-engine.ts", "utf8");
  assert.match(engine, /import \{ validPayrollLoanSchedule \} from "@\/lib\/payroll-loan-approval"/);
  assert.ok(engine.includes("if (!validPayrollLoanSchedule(loan))"), "financial invalidity must fail closed");
  assert.ok(engine.includes("No loan deduction applied; pause and reconcile"));
  assert.ok(engine.includes("return [] as Array<"), "never apply a malformed loan schedule");
  assert.ok(engine.includes('eq(employeeLoans.status, "active")'), "unapproved loans cannot reduce wages");
});
