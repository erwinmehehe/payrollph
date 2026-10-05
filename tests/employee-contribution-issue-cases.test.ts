import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("src/db/schema.ts", "utf8");
const selfApi = readFileSync("src/app/api/self/contribution-issues/route.ts", "utf8");
const payrollApi = readFileSync("src/app/api/compliance/contribution-issues/route.ts", "utf8");
const selfPayslips = readFileSync("src/app/api/self/payslips/route.ts", "utf8");
const portal = readFileSync("src/components/self-service-portal.tsx", "utf8");
const modal = readFileSync("src/components/employee-contribution-issue-modal.tsx", "utf8");
const payrollPanel = readFileSync("src/components/workspace/statutory-contribution-issue-cases-panel.tsx", "utf8");
const dashboardData = readFileSync("src/lib/dashboard-data.ts", "utf8");
const remittanceActions = readFileSync("src/lib/statutory-remittance-actions.ts", "utf8");

test("employee contribution issue cases are first-class immutable audit records", () => {
  assert.ok(schema.includes('export const statutoryContributionIssueCases = pgTable('));
  assert.ok(schema.includes('"statutory_contribution_issue_cases"'));
  assert.ok(schema.includes('employeeSnapshot: jsonb("employee_snapshot").notNull()'));
  assert.ok(schema.includes('resolutionNote: varchar("resolution_note"'));
});

test("employee reporting is bound to the signed-in employee, not a client-supplied employee id", () => {
  assert.ok(selfApi.includes('user.role !== "employee"'));
  assert.ok(selfApi.includes("user.employeeId"));
  assert.ok(selfApi.includes("eq(statutoryRemittanceMembers.employeeId, employee.id)"));
  assert.ok(!selfApi.includes("body.employeeId"));
});

test("employee report snapshots the contribution state instead of mutating remittance evidence", () => {
  assert.ok(selfApi.includes("employeeSnapshot: snapshot"));
  assert.ok(selfApi.includes('sourceType: "employee_contribution_issue"'));
  assert.ok(selfApi.includes("complianceActionTasks"));
  assert.ok(!selfApi.includes("db.update(statutoryRemittanceMembers)"));
});

test("duplicate open cases for the same agency month and issue type are blocked", () => {
  assert.ok(selfApi.includes('inArray(statutoryContributionIssueCases.status, ["open", "in_review"])'));
  assert.ok(selfApi.includes("You already have an open case"));
});

test("employee self-service only receives its own case history and contribution record ids", () => {
  assert.ok(selfPayslips.includes("memberId: statutoryRemittanceMembers.id"));
  assert.ok(selfPayslips.includes("batchId: statutoryRemittanceBatches.id"));
  assert.ok(selfPayslips.includes("eq(statutoryContributionIssueCases.employeeId, session.employeeId)"));
  assert.ok(selfPayslips.includes("contributionIssues: contributionIssueRows.map"));
});

test("payroll case resolution is company-wide, payroll-authorized, MFA-gated and does not rewrite contribution evidence", () => {
  assert.ok(payrollApi.includes("PAYROLL_OPERATOR_ROLES"));
  assert.ok(payrollApi.includes("!access.companyWide"));
  assert.ok(payrollApi.includes("requireSensitiveActionMfa(user)"));
  assert.ok(payrollApi.includes('action === "resolve"'));
  assert.ok(!payrollApi.includes("db.update(statutoryRemittanceMembers)"));
});

test("posting-confirmed outcome fails closed unless linked agency posting is actually confirmed", () => {
  assert.ok(payrollApi.includes('resolutionOutcome === "posting_confirmed"'));
  assert.ok(payrollApi.includes('member.postingStatus !== "confirmed"'));
  assert.ok(payrollApi.includes("Reconcile the posting evidence before resolving the case as confirmed."));
});

test("one payroll operator cannot silently take over another operator's employee case", () => {
  assert.ok(payrollApi.includes("issue.assignedToUserId != null && issue.assignedToUserId !== user.id"));
  assert.ok(payrollApi.includes("This contribution case is assigned to"));
});

test("employee UI lets users report a specific record or a missing record and tracks the response", () => {
  assert.ok(portal.includes("Report issue"));
  assert.ok(portal.includes("Report this record"));
  assert.ok(portal.includes("Your reported issues"));
  assert.ok(portal.includes("<EmployeeContributionIssueModal"));
  assert.ok(modal.includes("This creates a payroll compliance case."));
  assert.ok(modal.includes("Do not include passwords, OTPs or login credentials."));
});

test("payroll UI exposes a review inbox and reminds operators to use audited correction workflows", () => {
  assert.ok(payrollPanel.includes("EMPLOYEE CONTRIBUTION CASES"));
  assert.ok(payrollPanel.includes("Start review"));
  assert.ok(payrollPanel.includes("Resolve case"));
  assert.ok(payrollPanel.includes("existing audited remittance correction workflow"));
});

test("employee contribution cases flow into existing payroll notification data", () => {
  assert.ok(dashboardData.includes('inArray(complianceActionTasks.sourceType, ["statutory_remittance", "employee_contribution_issue"])'));
});


test("hourly remittance auto-sync cannot auto-resolve employee-reported contribution cases", () => {
  assert.ok(remittanceActions.includes('const SOURCE_TYPE = "statutory_remittance"'));
  assert.ok(remittanceActions.includes("eq(complianceActionTasks.sourceType, SOURCE_TYPE)"));
  assert.ok(!remittanceActions.includes('"employee_contribution_issue"'));
});
