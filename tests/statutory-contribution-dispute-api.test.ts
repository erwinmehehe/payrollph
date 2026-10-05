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
const schemaGuard = readFileSync("src/lib/statutory-contribution-dispute-schema.ts", "utf8");
const migration = readFileSync("drizzle/0028_statutory_contribution_disputes.sql", "utf8");
const dashboard = readFileSync("src/lib/dashboard-data.ts", "utf8");

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

test("payroll dispute resolution is company-wide, MFA protected, evidence gated, and independently dismissible", () => {
  assert.ok(complianceRoute.includes("access.companyWide"));
  assert.ok(complianceRoute.includes("PAYROLL_OPERATOR_ROLES"));
  assert.ok(complianceRoute.includes("CONTRIBUTION_DISPUTE_DISMISS_ROLES"));
  assert.ok(complianceRoute.includes("Only Owner, Admin, or Checker can dismiss"));
  assert.ok(complianceRoute.includes("The reporter cannot dismiss their own"));
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


test("missing-posting disputes re-resolve against current agency evidence", () => {
  assert.ok(complianceRoute.includes("statutoryRemittanceBatches"));
  assert.ok(complianceRoute.includes("const [currentBatch]"));
  assert.ok(complianceRoute.includes("eq(statutoryRemittanceMembers.employeeId, dispute.employeeId)"));
  assert.ok(complianceRoute.includes("memberId: member?.id ?? dispute.memberId"));
});

test("dispute schema self-initializes and blocks concurrent duplicate open reports", () => {
  assert.ok(selfRoute.includes("ensureStatutoryContributionDisputeSchema"));
  assert.ok(complianceRoute.includes("ensureStatutoryContributionDisputeSchema"));
  assert.ok(schemaGuard.includes("pg_advisory_xact_lock"));
  assert.ok(schemaGuard.includes("statutory_contribution_disputes_open_unique"));
  assert.ok(migration.includes("statutory_contribution_disputes_open_unique"));
  assert.ok(selfRoute.includes('code === "23505"'));
});

test("employee disputes appear in the payroll compliance alert feed", () => {
  assert.ok(dashboard.includes('"employee_contribution_dispute"'));
  assert.ok(dashboard.includes("inArray(complianceActionTasks.sourceType"));
});

test("checker UI can review disputes but payroll correction and independent dismissal stay separated", () => {
  assert.ok(payroll.includes('"checker"'));
  assert.ok(payroll.includes("role={data.access?.role"));
  assert.ok(panel.includes("canDismissAsNotError"));
  assert.ok(panel.includes("canPostResolution"));
  assert.ok(panel.includes("independent Checker review"));
});
