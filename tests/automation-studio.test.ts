import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const engine = readFileSync("src/lib/automation.ts", "utf8");
const api = readFileSync("src/app/api/automation-studio/route.ts", "utf8");
const panel = readFileSync("src/components/automation-studio-panel.tsx", "utf8");
const nav = readFileSync("src/components/workspace/nav.ts", "utf8");
const workspace = readFileSync("src/components/linaw-workspace.tsx", "utf8");
const employees = readFileSync("src/app/api/employees/route.ts", "utf8");
const transfer = readFileSync("src/app/api/workforce-planning/transfer/route.ts", "utf8");
const payrollCreate = readFileSync("src/app/api/payroll-runs/route.ts", "utf8");
const payrollSubmit = readFileSync("src/app/api/payroll-runs/[id]/submit-review/route.ts", "utf8");
const approvals = readFileSync("src/app/api/approvals/[id]/route.ts", "utf8");
const payrollRelease = readFileSync("src/app/api/payroll-runs/[id]/release/route.ts", "utf8");
const overtime = readFileSync("src/app/api/workforce/overtime/route.ts", "utf8");
const leave = readFileSync("src/app/api/leave/route.ts", "utf8");
const compensation = readFileSync("src/app/api/compensation/route.ts", "utf8");
const recruitment = readFileSync("src/app/api/recruitment/route.ts", "utf8");
const recruitmentHire = readFileSync("src/app/api/recruitment/hire/route.ts", "utf8");
const webhookSigning = readFileSync("src/lib/webhook-signing.ts", "utf8");

test("Automation Studio exposes the broad event catalog with live and planned adapters separated", () => {
  for (const trigger of [
    "employee.hired",
    "employee.updated",
    "employee.moved",
    "employee.promoted",
    "employee.separated",
    "payroll.created",
    "payroll.submitted",
    "payroll.approved",
    "payroll.released",
    "attendance.exception_created",
    "overtime.requested",
    "overtime.approved",
    "leave.requested",
    "leave.approved",
    "compensation.changed",
    "candidate.hired",
    "position.opened",
    "document.expires",
    "government.remittance_due",
    "contribution.discrepancy_detected",
  ]) {
    assert.ok(engine.includes(`"${trigger}"`), `missing trigger ${trigger}`);
  }
  assert.ok(engine.includes("AUTOMATION_LIVE_TRIGGERS"));
  assert.ok(engine.includes("AUTOMATION_PLANNED_TRIGGERS"));
  assert.ok(api.includes("automationTriggerIsLive"));
  assert.ok(api.includes("authoritative event adapter is not connected yet"));
});

test("Automation Studio conditions support deterministic string and numeric comparisons", () => {
  for (const operator of ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in", "exists"]) {
    assert.ok(engine.includes(`"${operator}"`), `missing operator ${operator}`);
  }
  for (const field of [
    "department",
    "location",
    "employmentType",
    "title",
    "jobFamily",
    "jobLevel",
    "salary",
    "tenureYears",
    "payrollAmount",
    "overtimeMinutes",
    "positionCode",
    "legalEntityId",
  ]) {
    assert.ok(engine.includes(`value: "${field}"`), `missing condition field ${field}`);
  }
  assert.ok(engine.includes("valueAtPath"));
  assert.ok(engine.includes("conditionClauseMatches"));
});

test("Automation Studio actions are governed adapters rather than arbitrary mutation", () => {
  for (const action of [
    "create_task",
    "create_onboarding_checklist",
    "request_approval",
    "send_email",
    "assign_permission_set",
    "assign_benefit",
    "revoke_sessions",
    "deactivate_access",
    "request_payroll_adjustment",
    "webhook",
  ]) {
    assert.ok(engine.includes(`type: "${action}"`) || engine.includes(`type === "${action}"`), `missing action ${action}`);
  }

  assert.ok(engine.includes("appliedAutomatically: false"));
  assert.ok(engine.includes("Approval required before payroll mutation"));
  assert.ok(engine.includes("Session revocation automation is allowed only for employee separation."));
  assert.ok(engine.includes("Workspace-access removal is allowed only for employee separation."));
  assert.ok(engine.includes("tx.update") === false, "engine should not manufacture its own transaction bypass layer");
  assert.equal(engine.includes("fetch("), false, "automation engine must not call arbitrary external URLs");
  assert.ok(webhookSigning.includes('"automation.triggered"'));
});

test("access orchestration remains workspace scoped and does not globally disable shared users", () => {
  assert.ok(engine.includes("db.update(userOrganizations).set({ active: false })"));
  assert.ok(engine.includes("db.update(scimIdentities).set({ active: false"));
  assert.ok(engine.includes("db.update(sessions).set({ revokedAt: new Date() })"));
  assert.equal(engine.includes("db.update(users).set({ active: false })"), false);
  assert.ok(engine.includes("userPermissionAssignments"));
  assert.ok(engine.includes("eq(userOrganizations.active, true)"));
  assert.ok(engine.includes("eq(permissionSets.active, true)"));
});

test("automation failures cannot roll back authoritative HR or payroll transactions", () => {
  assert.ok(engine.includes("runAutomationEventSafely"));
  assert.ok(engine.includes('status: "engine_error"'));
  assert.ok(engine.includes("Automation outages or malformed secondary integrations"));
  assert.ok(engine.includes(".onConflictDoNothing().returning()"));
  assert.ok(engine.includes('const status = failed.length === 0 ? "completed"'));
  assert.ok(engine.includes('"partial"'));
  assert.ok(engine.includes('"waiting"'));
  assert.ok(engine.includes('"waiting_approval"'));
});

test("Studio management is company-wide admin, MFA, rate-limit, and same-origin protected", () => {
  assert.ok(api.includes("ORG_ADMIN_ROLES"));
  assert.ok(api.includes("company-wide access"));
  assert.ok(api.includes("requireSensitiveActionMfa"));
  assert.ok(api.includes("enforceSensitiveActionRateLimit"));
  assert.ok(api.includes("enforceSameOriginMutation"));
  assert.ok(api.includes("publicDemoMutationDenied"));
});

test("WHEN IF THEN builder exposes multiple ordered actions and execution evidence", () => {
  assert.ok(panel.includes("AUTOMATION STUDIO"));
  assert.ok(panel.includes("Build governed WHEN / IF / THEN workflows."));
  assert.ok(panel.includes("WHEN"));
  assert.ok(panel.includes("IF"));
  assert.ok(panel.includes("THEN"));
  assert.ok(panel.includes("Add") || panel.includes("Action"));
  assert.ok(panel.includes("actions.map"));
  assert.ok(panel.includes("planned"));
  assert.ok(panel.includes("EXECUTION EVIDENCE"));
  assert.ok(panel.includes("Payroll adjustments become approval requests"));
  assert.ok(panel.includes("Arbitrary URLs are not accepted."));
  assert.ok(nav.includes('{ name: "Automation"'));
  assert.ok(workspace.includes("<AutomationStudioPanel"));
});

test("live authoritative route adapters emit Automation Studio events after their source changes", () => {
  assert.ok(employees.includes('trigger: "employee.updated"'));
  assert.ok(transfer.includes('trigger: "employee.moved"'));
  assert.ok(transfer.includes('trigger: "employee.promoted"'));
  assert.ok(payrollCreate.includes('trigger: "payroll.created"'));
  assert.ok(payrollSubmit.includes('trigger: "payroll.submitted"'));
  assert.ok(approvals.includes('trigger: "payroll.approved"'));
  assert.ok(payrollRelease.includes('trigger: "payroll.released"'));
  assert.ok(overtime.includes('trigger: "overtime.requested"'));
  assert.ok(overtime.includes('trigger: "overtime.approved"'));
  assert.ok(leave.includes('trigger: "leave.requested"'));
  assert.ok(approvals.includes('trigger: "leave.approved"'));
  assert.ok(compensation.includes('trigger: "compensation.changed"'));
  assert.ok(recruitmentHire.includes('trigger: "candidate.hired"'));
  assert.ok(recruitmentHire.includes('trigger: "employee.hired"'));
  assert.ok(recruitment.includes('trigger: "position.opened"'));
});

test("legacy joiner mover leaver callers remain backward compatible", () => {
  assert.ok(engine.includes("export const LIFECYCLE_TRIGGERS"));
  assert.ok(engine.includes("export async function runLifecycleAutomations"));
  assert.ok(engine.includes("normalizeLifecycleActions"));
  assert.ok(engine.includes("validLifecycleConditions"));
});
