import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("src/db/schema.ts", "utf8");
const route = readFileSync("src/app/api/compliance/remittance-actions/route.ts", "utf8");
const state = readFileSync("src/lib/statutory-remittance-state.ts", "utf8");
const remittanceRoute = readFileSync("src/app/api/compliance/statutory-remittances/route.ts", "utf8");
const panel = readFileSync("src/components/workspace/statutory-remittance-panel.tsx", "utf8");
const queue = readFileSync("src/components/workspace/statutory-remittance-action-queue.tsx", "utf8");
const payroll = readFileSync("src/components/workspace/payroll-run.tsx", "utf8");
const dashboardData = readFileSync("src/lib/dashboard-data.ts", "utf8");
const dashboardTypes = readFileSync("src/components/workspace/types.ts", "utf8");
const shell = readFileSync("src/components/workspace/shell.tsx", "utf8");
const actions = readFileSync("src/lib/statutory-remittance-actions.ts", "utf8");
const scheduler = readFileSync("src/lib/scheduler.ts", "utf8");
const worker = readFileSync("scripts/worker.ts", "utf8");

test("compliance actions are first-class persistent records, not approval tasks", () => {
  assert.ok(schema.includes('export const complianceActionTasks = pgTable('));
  assert.ok(schema.includes('"compliance_action_tasks"'));
  assert.ok(schema.includes('uniqueIndex("compliance_action_source_unique")'));
  assert.ok(schema.includes('assignedToUserId: integer("assigned_to_user_id")'));
  assert.ok(schema.includes('resolvedAt: timestamp("resolved_at"'));
});

test("dashboard alerts and action queue share one remittance state loader", () => {
  assert.ok(state.includes("buildStatutoryRemittanceAlerts"));
  assert.ok(remittanceRoute.includes("loadStatutoryRemittanceState"));
  assert.ok(actions.includes("loadStatutoryRemittanceState"));
  assert.ok(route.includes("syncStatutoryRemittanceActions"));
});

test("queue sync creates, reopens and auto-resolves from underlying evidence", () => {
  assert.ok(actions.includes("activeKeys"));
  assert.ok(actions.includes('current.status === "resolved"'));
  assert.ok(actions.includes('status: "open"'));
  assert.ok(actions.includes('eq(complianceActionTasks.status, "resolved")'));
  assert.ok(actions.includes('status: "resolved"'));
  assert.ok(actions.includes("resolved += 1"));
  assert.ok(actions.includes("reopened += 1"));
  assert.ok(actions.includes("onConflictDoNothing"));
  assert.ok(actions.includes("returning({ id: complianceActionTasks.id })"));
});

test("operators cannot manually resolve a statutory compliance action", () => {
  assert.ok(route.includes("Compliance actions resolve only from underlying evidence."));
  assert.ok(!route.includes('action === "resolve"'));
  assert.ok(route.includes("Resolved compliance actions are read-only."));
});

test("assignment is restricted to authorized payroll operators in the same organization", () => {
  assert.ok(route.includes("PAYROLL_OPERATOR_ROLES"));
  assert.ok(route.includes("roleAllowed(membership.role, PAYROLL_OPERATOR_ROLES)"));
  assert.ok(route.includes("eq(userOrganizations.organizationId, organizationId)"));
  assert.ok(route.includes("eq(userOrganizations.userId, assignedToUserId)"));
});

test("queue mutations use same-origin protection, rate limits and audit events", () => {
  assert.ok(route.includes("enforceSameOriginMutation(request)"));
  assert.ok(route.includes("enforceSensitiveActionRateLimit(request"));
  assert.ok(route.includes("recordAuditEvent"));
});

test("remittance changes trigger queue resynchronization and payroll exposes the queue", () => {
  assert.ok(panel.includes('window.dispatchEvent(new Event("statutory-remittance-changed"))'));
  assert.ok(queue.includes('window.addEventListener("statutory-remittance-changed"'));
  assert.ok(queue.includes('action: "sync"'));
  assert.ok(queue.includes("cannot be manually closed"));
  assert.ok(payroll.includes("<StatutoryRemittanceActionQueue"));
});


test("dashboard exposes compliance actions only to company-wide payroll operators", () => {
  assert.ok(dashboardData.includes("canViewComplianceActions = access.companyWide"));
  assert.ok(dashboardData.includes("PAYROLL_OPERATOR_ROLES"));
  assert.ok(dashboardData.includes("complianceActions,"));
  assert.ok(dashboardTypes.includes("complianceActions?: ComplianceActionTask[]"));
});

test("existing notification tray escalates unresolved remittance actions", () => {
  assert.ok(shell.includes("addComplianceActionNotifications"));
  assert.ok(shell.includes("data.complianceActions ?? []"));
  assert.ok(shell.includes("Unassigned critical:"));
  assert.ok(shell.includes('page: "Payroll"'));
  assert.ok(shell.includes('["owner", "admin", "bookkeeper", "payroll"]'));
});


test("scheduler and dedicated worker synchronize remittance actions without a page visit", () => {
  assert.ok(actions.includes('const SCHEDULE_INTERVAL_MS = 60 * 60 * 1000'));
  assert.ok(actions.includes('jobName, SCHEDULE_JOB'));
  assert.ok(actions.includes("syncAllStatutoryRemittanceActions"));
  assert.ok(scheduler.includes("runScheduledStatutoryRemittanceSync"));
  assert.ok(worker.includes("await tickScheduler()"), "dedicated worker must invoke the central scheduler");
  assert.ok(scheduler.includes('actor: "System scheduler"'), "the central scheduler must own remittance execution");
});


test("background monitor isolates organization failures instead of aborting the full sweep", () => {
  assert.ok(actions.includes("try {"));
  assert.ok(actions.includes("Unknown remittance monitor error"));
  assert.ok(actions.includes("const failures = results.filter"));
  assert.ok(actions.includes("failures,"));
});

test("compliance action assignee API does not expose unused email addresses", () => {
  assert.ok(!route.includes("email: users.email"));
  assert.ok(!queue.includes("email: string"));
});


test("dashboard payload excludes resolved compliance history and stays bounded", () => {
  assert.ok(dashboardData.includes('ne(complianceActionTasks.status, "resolved")'));
  assert.ok(dashboardData.includes(".limit(20)"));
});


test("assigned compliance actions require explicit reassignment before another user can acknowledge", () => {
  assert.ok(route.includes("task.assignedToUserId != null && task.assignedToUserId !== user.id"));
  assert.ok(route.includes("Reassign it before acknowledging."));
  assert.ok(queue.includes("Assigned to {task.assignedToName"));
  assert.ok(queue.includes('task.assignedToUserId == null ? "Take ownership" : "Start work"'));
});

test("reassigning in-progress compliance work resets acknowledgement for the new owner", () => {
  assert.ok(route.includes("ownershipChanged && task.status === \"in_progress\""));
  assert.ok(route.includes('status: "open"'));
  assert.ok(route.includes("acknowledgedByUserId: null"));
});

test("notification dashboard fetch is limited to approved statutory compliance action sources", () => {
  assert.ok(dashboardData.includes('inArray(complianceActionTasks.sourceType, ["statutory_remittance", "employee_contribution_issue"])'));
  assert.ok(dashboardData.includes('ne(complianceActionTasks.status, "resolved")'));
});

test("compliance queue exposes total age and current severity age to operators", () => {
  assert.ok(route.includes("severityAgeHours"));
  assert.ok(route.includes("escalationStage: escalationStage(task, now)"));
  assert.ok(queue.includes("current risk level"));
  assert.ok(queue.includes("24h follow-up"));
  assert.ok(queue.includes("executive escalation in"));
});
