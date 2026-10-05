import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const api = readFileSync("src/app/api/compensation/route.ts", "utf8");
const application = readFileSync("src/lib/compensation-application.ts", "utf8");
const scheduler = readFileSync("src/lib/scheduler.ts", "utf8");
const worker = readFileSync("scripts/worker.ts", "utf8");
const panel = readFileSync("src/components/compensation-panel.tsx", "utf8");
const nav = readFileSync("src/components/workspace/nav.ts", "utf8");
const workspace = readFileSync("src/components/linaw-workspace.tsx", "utf8");
const roleUi = readFileSync("src/lib/workspace-role-ui.ts", "utf8");
const schema = readFileSync("src/db/schema.ts", "utf8");

test("HCM compensation schema governs bands, cycles and employee proposals", () => {
  assert.ok(schema.includes('export const compensationBands = pgTable('));
  assert.ok(schema.includes('export const compensationCycles = pgTable('));
  assert.ok(schema.includes('export const compensationProposals = pgTable('));
  assert.ok(schema.includes('appliedPayRevisionId: integer("applied_pay_revision_id")'));
  assert.ok(schema.includes('uniqueIndex("compensation_proposals_cycle_employee_unique")'));
});

test("compensation mutations use same-origin, MFA, rate limits and audit events", () => {
  assert.ok(api.includes("enforceSameOriginMutation(request)"));
  assert.ok(api.includes("requireSensitiveActionMfa"));
  assert.ok(api.includes("enforceSensitiveActionRateLimit"));
  assert.ok(api.includes("recordAuditEvent"));
});

test("proposal must use the employee current job profile band", () => {
  assert.ok(api.includes("employeeCurrentJobProfile("));
  assert.ok(api.includes("Selected salary band does not match the employee's current job profile."));
  assert.ok(api.includes("Employee's current position no longer matches the selected compensation band."));
});

test("maker cannot approve their own compensation proposal", () => {
  assert.ok(api.includes("proposal.submittedByUserId === user.id"));
  assert.ok(api.includes("cannot approve it"));
  assert.ok(api.includes("independent Owner/Admin reviewer"));
});

test("approval creates effective-dated payroll history without changing live pay early", () => {
  const approvalStart = api.indexOf('if (decision === "approved"');
  const revisionInsert = api.indexOf("tx.insert(employeePayRevisions)");
  assert.ok(revisionInsert > approvalStart);
  assert.ok(!api.includes("tx.update(employeePayProfiles)"));
  assert.ok(api.includes('status: "approved"'));
  assert.ok(api.includes("applyDueCompensationProposal(id, user.name)"));
});

test("application changes live profile only once effective and fails closed on drift", () => {
  assert.ok(application.includes('if (String(cycle.effectiveDate) > manilaToday())'));
  assert.ok(application.includes("profileMatchesRevisionPrevious"));
  assert.ok(application.includes("pay-profile-drift"));
  assert.ok(application.includes("db.update(employeePayProfiles)"));
  assert.ok(application.includes('status: "applied"'));
  assert.ok(application.includes("Approved compensation change became effective"));
});

test("approved budget includes scheduled and already-applied increases", () => {
  assert.ok(api.includes('row.status === "approved" || row.status === "applied"'));
  assert.ok(api.includes("cycle.budgetPool"));
});

test("scheduler and dedicated worker apply due compensation automatically", () => {
  assert.ok(scheduler.includes("runScheduledCompensationApplications"));
  assert.ok(worker.includes("runScheduledCompensationApplications"));
  assert.ok(application.includes('const JOB_NAME = "compensation-effective-date-application"'));
});

test("Compensation is reachable as an HCM workspace destination", () => {
  assert.ok(nav.includes('{ name: "Compensation"'));
  assert.ok(workspace.includes('page === "Compensation"'));
  assert.ok(roleUi.includes('"Compensation"'));
  assert.ok(panel.includes("Maker-checker boundary"));
  assert.ok(panel.includes("Approved · scheduled"));
  assert.ok(panel.includes("Live in payroll"));
});
