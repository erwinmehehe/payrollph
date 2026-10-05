import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const api = readFileSync("src/app/api/compliance/remittances/route.ts", "utf8");
const settlement = readFileSync("src/lib/payroll-settlement.ts", "utf8");
const checklist = readFileSync("src/lib/payroll-release-checklist.ts", "utf8");
const selfService = readFileSync("src/app/api/self/payslips/route.ts", "utf8");
const scheduler = readFileSync("src/lib/scheduler.ts", "utf8");
const reminders = readFileSync("src/lib/statutory-remittance-reminders.ts", "utf8");

test("remittance evidence is protected by payroll RBAC, MFA, same-origin and rate limits", () => {
  assert.ok(api.includes("PEOPLE_PAYROLL_ROLES"));
  assert.ok(api.includes("access?.companyWide"));
  assert.ok(api.includes("enforceSameOriginMutation(request)"));
  assert.ok(api.includes("requireSensitiveActionMfa(user)"));
  assert.ok(api.includes("enforceSensitiveActionRateLimit(request"));
});

test("payment evidence must match the payroll liability and cannot self-confirm", () => {
  assert.ok(api.includes("remittanceAmountMatches(Number(row.expectedTotalAmount), paidAmount)"));
  assert.ok(api.includes("row.recordedByUserId === user.id"));
  assert.ok(api.includes("cannot also confirm agency posting"));
  assert.ok(api.includes('eq(statutoryRemittanceObligations.status, "payment_recorded")'));
});

test("payroll release atomically creates or reconciles monthly remittance obligations", () => {
  assert.ok(settlement.includes("statutoryRemittanceTotals(monthlyReleasedEntries)"));
  assert.ok(settlement.includes("statutoryRemittanceDeadline({"));
  assert.ok(settlement.includes("statutoryRemittanceObligations"));
  assert.ok(settlement.includes('status: deadline.dueDate ? "pending" : "needs_configuration"'));
  assert.ok(settlement.includes('"needs_review"'));
});

test("release checklist blocks missing payslips and overdue contribution remittance", () => {
  assert.ok(checklist.includes('key:"payslips"'));
  assert.ok(checklist.includes('key:"remittance"'));
  assert.ok(checklist.includes("overdueRemittances.length === 0"));
  assert.ok(checklist.includes("payslipRows.length === rows.length"));
});

test("employee self-service exposes only their own deductions plus employer remittance status", () => {
  assert.ok(selfService.includes("contributionStatus"));
  assert.ok(selfService.includes('amountFor(["SSS"])'));
  assert.ok(selfService.includes('amountFor(["PHIC"])'));
  assert.ok(selfService.includes('amountFor(["HDMF", "HDMF_VOL"])'));
  assert.ok(selfService.includes("remittanceStatus: obligation?.status ?? \"not_recorded\""));
  assert.ok(selfService.includes("eq(payrollEntries.employeeId, session.employeeId)"));
});


test("scheduler proactively queues due-soon and overdue remittance reminders", () => {
  assert.ok(scheduler.includes("queueStatutoryRemittanceReminders(now)"));
  assert.ok(scheduler.includes('"statutory-remittance-reminders"'));
  assert.ok(reminders.includes('"due-soon"'));
  assert.ok(reminders.includes('"overdue"'));
  assert.ok(reminders.includes('purpose: "statutory-remittance-reminder"'));
  assert.ok(reminders.includes("PayrollPH blocks future payroll release"));
});
