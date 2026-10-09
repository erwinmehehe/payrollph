import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

// Static release integrity assertions only. These never connect to PostgreSQL,
// execute DDL, enable a feature flag, or process an employee payment.
const migrationNames = [
  "0100_compensation_automation_intents.sql",
  "0101_reviewed_payroll_underpayments.sql",
  "0102_final_pay_maker_checker.sql",
  "0103_independent_employee_loan_deductions.sql",
] as const;

test("financial migration integration has one contiguous 0100-0103 sequence", () => {
  const names = readdirSync("drizzle").filter(name => /^01\d{2}_[a-z0-9_-]+\.sql$/.test(name));
  assert.deepEqual(names.sort(), [...migrationNames].sort(),
    "do not merge a second 0100, skip an ancestor or silently add later financial DDL");
  for (const [index, name] of migrationNames.entries()) {
    assert.equal(name.slice(0, 4), String(100 + index).padStart(4, "0"));
  }
  assert.equal(new Set(names.map(name => name.slice(0, 4))).size, names.length);
});

test("financial SQL migration sources remain additive and financially separated", () => {
  const [compensation, underpayment, separation, loan] =
    migrationNames.map(name => readFileSync("drizzle/" + name, "utf8"));
  assert.match(compensation, /CREATE TABLE IF NOT EXISTS "compensation_automation_intents"/);
  assert.match(underpayment, /"payroll_underpayment_requests"/);
  assert.match(separation, /"prepared_by_user_id"/);
  assert.match(separation, /"approved_by_user_id"/);
  assert.match(separation, /"released_by_user_id"/);
  assert.match(loan, /ALTER COLUMN "status" SET DEFAULT 'pending_approval'/);
  assert.match(loan, /employee_loans_independent_deduction_check/);
  for (const sql of [compensation, underpayment, separation, loan]) {
    assert.doesNotMatch(sql, /\bDROP\s+(?:TABLE|COLUMN|SCHEMA)\b/i,
      "destructive financial DDL requires a separately reviewed migration");
  }
});

test("integrated Drizzle schema retains all four independent financial-control models", () => {
  const schema = readFileSync("src/db/schema.ts", "utf8");
  for (const model of [
    "compensationAutomationIntents", "payrollUnderpaymentRequests",
    "separationRecords", "employeeLoans",
  ]) {
    assert.equal(schema.split("export const " + model + " =").length, 2,
      "missing or duplicate Drizzle model: " + model);
  }
  for (const field of [
    'preparedByUserId: integer("prepared_by_user_id")',
    'approvedByUserId: integer("approved_by_user_id")',
    'releasedByUserId: integer("released_by_user_id")',
    'requestedByUserId: integer("requested_by_user_id")',
    'reviewedByUserId: integer("reviewed_by_user_id")',
    'eventKey: varchar("event_key"',
  ]) assert.ok(schema.includes(field), "missing integrated control: " + field);
  assert.ok(schema.includes('status: varchar("status", { length: 32 }).notNull().default("pending_approval")'),
    "new loan deductions must remain pending before independent approval");
});

test("loan governance test and runbook refer to the integrated migration", () => {
  const testSource = readFileSync("tests/payroll-loan-approval-governance.test.ts", "utf8");
  const runbook = readFileSync("docs/payroll-employee-loan-maker-checker.md", "utf8");
  for (const source of [testSource, runbook]) {
    assert.ok(source.includes("0103_independent_employee_loan_deductions.sql"));
    assert.ok(!source.includes("0100_independent_employee_loan_deductions.sql"),
      "source loan migration number collides with compensation 0100");
  }
});
