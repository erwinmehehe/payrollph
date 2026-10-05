import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const selfRoute = readFileSync("src/app/api/self/contribution-disputes/route.ts", "utf8");
const complianceRoute = readFileSync("src/app/api/compliance/contribution-disputes/route.ts", "utf8");
const actionRoute = readFileSync("src/app/api/compliance/remittance-actions/route.ts", "utf8");
const selfUi = readFileSync("src/components/self-service-portal.tsx", "utf8");
const reporter = readFileSync("src/components/contribution-dispute-reporter.tsx", "utf8");
const payroll = readFileSync("src/components/workspace/payroll-run.tsx", "utf8");
const panel = readFileSync("src/components/workspace/statutory-contribution-disputes-panel.tsx", "utf8");
const schema = readFileSync("src/db/schema.ts", "utf8");

test("employee contribution reports are scoped to the signed-in employee", () => {
  assert.ok(selfRoute.includes("if (!user.employeeId)"));
  assert.ok(selfRoute.includes("assertMembership(userId, organizationId)"));
  assert.ok(selfRoute.includes("employeeForSession(user.id, user.employeeId, organizationId)"));
  assert.ok(selfRoute.includes("eq(statutoryContributionDisputes.employeeId, user.employeeId)"));
  assert.ok(selfRoute.includes("eq(employees.id, employeeId)"));
});

test("employee report validation blocks future months and duplicate unresolved reports", () => {
  assert.ok(selfRoute.includes("applicableMonth > currentManilaMonth()"));
  assert.ok(selfRoute.includes("You already have an unresolved report"));
  assert.ok(selfRoute.includes('issueType === "wrong_amount"'));
  assert.ok(selfRoute.includes('issueType === "wrong_reference"'));
});

test("every employee report creates a first-class compliance action", () => {
  assert.ok(schema.includes('export const statutoryContributionDisputes = pgTable('));
  assert.ok(selfRoute.includes('sourceType: "employee_contribution_dispute"'));
  assert.ok(selfRoute.includes('sourceKey: `dispute:${dispute.id}`'));
  assert.ok(selfRoute.includes("complianceActionTasks"));
});

test("compliance queue can own both remittance alerts and employee disputes", () => {
  assert.ok(actionRoute.includes("SUPPORTED_SOURCE_TYPES"));
  assert.ok(actionRoute.includes('"employee_contribution_dispute"'));
  assert.ok(actionRoute.includes("inArray(complianceActionTasks.sourceType"));
});

test("payroll dispute resolution is company-wide, MFA protected, and evidence gated", () => {
  assert.ok(complianceRoute.includes("access.companyWide"));
  assert.ok(complianceRoute.includes("PAYROLL_OPERATOR_ROLES"));
  assert.ok(complianceRoute.includes("requireSensitiveActionMfa(user)"));
  assert.ok(complianceRoute.includes("validateContributionDisputeResolution"));
  assert.ok(complianceRoute.includes('eq(complianceActionTasks.sourceType, "employee_contribution_dispute")'));
});

test("employee and payroll UIs expose contribution dispute workflow", () => {
  assert.ok(selfUi.includes("<ContributionDisputeReporter"));
  assert.ok(reporter.includes("Report a problem"));
  assert.ok(reporter.includes("Your report is with payroll for review."));
  assert.ok(payroll.includes("<StatutoryContributionDisputesPanel"));
  assert.ok(panel.includes("Queue acknowledgement is not resolution."));
});
