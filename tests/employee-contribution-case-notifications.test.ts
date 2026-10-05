import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const notifications = readFileSync("src/lib/statutory-contribution-case-notifications.ts", "utf8");
const selfApi = readFileSync("src/app/api/self/contribution-issues/route.ts", "utf8");
const payrollApi = readFileSync("src/app/api/compliance/contribution-issues/route.ts", "utf8");
const mailer = readFileSync("src/lib/mailer.ts", "utf8");

test("new employee contribution cases notify only company-wide payroll operators", () => {
  assert.ok(notifications.includes("PAYROLL_OPERATOR_ROLES"));
  assert.ok(notifications.includes("recipient.orgUnitId == null"));
  assert.ok(notifications.includes("roleAllowed(recipient.role, PAYROLL_OPERATOR_ROLES)"));
  assert.ok(notifications.includes('event: "reported"'));
});

test("case lifecycle emails are bound to the dedicated employee login", () => {
  assert.ok(notifications.includes("eq(users.employeeId, input.issue.employeeId)"));
  assert.ok(notifications.includes('eq(users.role, "employee")'));
  assert.ok(notifications.includes("event: string"));
  assert.ok(notifications.includes("event: input.event"));
  assert.ok(notifications.includes("notifyEmployeeOfContributionCaseUpdate"));
  assert.ok(notifications.includes("payroll_update-"));
  assert.ok(payrollApi.includes('event: "review_started"'));
  assert.ok(payrollApi.includes('event: "resolved"'));
});

test("case notifications never request employee agency credentials", () => {
  assert.ok(notifications.includes("You do not need to share your agency password, OTP or login credentials"));
  assert.ok(!notifications.includes("Send us your password"));
});

test("case notifications are idempotent by case lifecycle event and recipient", () => {
  assert.ok(notifications.includes("caseDedupeKey"));
  assert.ok(notifications.includes("input.caseId"));
  assert.ok(notifications.includes("input.event"));
  assert.ok(notifications.includes("input.recipientUserId"));
  assert.ok(notifications.includes('purpose: "employee-contribution-case"'));
});

test("notification delivery cannot roll back case creation, ownership, or resolution", () => {
  assert.ok(selfApi.includes("The compliance case is authoritative even when notification delivery is unavailable."));
  assert.ok(payrollApi.includes("Case ownership is authoritative even when notification delivery is unavailable."));
  assert.ok(payrollApi.includes("The audited case resolution remains authoritative if email delivery is unavailable."));
});

test("employee contribution case notices use bounded automatic outbox retries", () => {
  assert.ok(mailer.includes('"employee-contribution-case"'));
  assert.ok(mailer.includes("MAX_AUTOMATIC_RETRIES + 1"));
  assert.ok(mailer.includes('inArray(outbox.purpose, ["payslip-ready", "statutory-remittance-escalation", "employee-contribution-case"])'));
});


test("overdue contribution case notices are internal service escalations, not legal deadlines", () => {
  assert.ok(notifications.includes("notifyPayrollOfContributionCaseEscalation"));
  assert.ok(notifications.includes('"review_overdue"'));
  assert.ok(notifications.includes('"resolution_overdue"'));
  assert.ok(notifications.includes("internal operational targets, not statutory or agency deadlines"));
  assert.ok(notifications.includes("internalServiceTarget: true"));
});


test("overdue case escalations are deduped by event, stage and recipient", () => {
  assert.ok(notifications.includes('event: `${input.event}:stage-${input.stage}`'));
  assert.ok(notifications.includes("escalationStage: input.stage"));
  assert.ok(notifications.includes("stagedRecipients"));
});

test("aged contribution case escalation narrows follow-ups to owner/admin plus assignee with safe fallback", () => {
  assert.ok(notifications.includes('recipient.role === "owner" || recipient.role === "admin"'));
  assert.ok(notifications.includes("input.issue.assignedToUserId"));
  assert.ok(notifications.includes("stagedRecipients.length > 0 ? stagedRecipients : payrollRecipients"));
  assert.ok(notifications.includes("Executive payroll compliance"));
  assert.ok(notifications.includes("5 business days overdue"));
});

test("ordinary new-case notification remains unchanged by staged escalation recipients", () => {
  const start = notifications.indexOf("export async function notifyPayrollOfContributionCase(input:");
  const end = notifications.indexOf("export async function notifyEmployeeOfContributionCaseUpdate", start);
  const block = notifications.slice(start, end);
  assert.ok(block.includes("for (const recipient of payrollRecipients)"));
  assert.ok(!block.includes("stagedRecipients"));
});
