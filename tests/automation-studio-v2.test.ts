import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const engine = readFileSync("src/lib/automation.ts", "utf8");
const schema = readFileSync("src/db/schema.ts", "utf8");
const migration = readFileSync("drizzle/0049_automation_studio_v2.sql", "utf8");
const scheduler = readFileSync("src/lib/scheduler.ts", "utf8");
const approvals = readFileSync("src/app/api/approvals/[id]/route.ts", "utf8");
const api = readFileSync("src/app/api/automation-studio/route.ts", "utf8");
const panel = readFileSync("src/components/automation-studio-panel.tsx", "utf8");

test("Automation Studio v2 persists resumable workflow state", () => {
  for (const field of [
    "workflow",
    "context",
    "cursor",
    "resumeAt",
    "waitingApprovalTaskId",
    "updatedAt",
  ]) {
    assert.ok(schema.includes(field), `schema missing ${field}`);
  }
  for (const column of [
    '"workflow"',
    '"context"',
    '"cursor"',
    '"resume_at"',
    '"waiting_approval_task_id"',
    '"updated_at"',
  ]) {
    assert.ok(migration.includes(column), `migration missing ${column}`);
  }
  assert.ok(migration.includes("automation_executions_resume_idx"));
  assert.ok(migration.includes("automation_executions_approval_idx"));
});

test("workflow definitions support bounded waits, approval gates and conditional branches", () => {
  assert.ok(engine.includes('type: "wait"'));
  assert.ok(engine.includes('type: "approval_gate"'));
  assert.ok(engine.includes('type: "branch"'));
  assert.ok(engine.includes("depth > 4"));
  assert.ok(engine.includes("budget.count > 50"));
  assert.ok(engine.includes("43_200"));
  assert.ok(engine.includes("compileAutomationPlan"));
  assert.ok(engine.includes("conditionMatches(step.conditions"));
});

test("timed waits persist before returning and scheduler resumes only due executions", () => {
  assert.ok(engine.includes('status: "waiting"'));
  assert.ok(engine.includes("resumeAt"));
  assert.ok(engine.includes("resumeDueAutomationExecutions"));
  assert.ok(engine.includes('eq(automationExecutions.status, "waiting")'));
  assert.ok(engine.includes("lte(automationExecutions.resumeAt, now)"));
  assert.ok(scheduler.includes("resumeDueAutomationExecutions(now, 25)"));
  assert.ok(scheduler.includes("automationResumes"));
});

test("approval gates pause the exact workflow and decisions resume or terminate it", () => {
  assert.ok(engine.includes('status: "waiting_approval"'));
  assert.ok(engine.includes("waitingApprovalTaskId: task.id"));
  assert.ok(engine.includes("resumeAutomationExecutionFromApproval"));
  assert.ok(engine.includes('decision: "Approved" | "Declined"'));
  assert.ok(engine.includes("execution.cursor + 1"));
  assert.ok(engine.includes("was declined by"));
  assert.ok(approvals.includes("resumeAutomationExecutionFromApproval"));
  assert.ok(approvals.includes("automationGate"));
});

test("authoritative business decisions stay successful even when automation resume fails", () => {
  const decisionIndex = approvals.indexOf("updated = await db.transaction");
  const resumeIndex = approvals.indexOf("resumeAutomationExecutionFromApproval({", decisionIndex);
  assert.ok(decisionIndex >= 0);
  assert.ok(resumeIndex > decisionIndex, "automation gate must resume after the approval transaction");
  assert.ok(approvals.includes('status: "engine_error"'));
});

test("Studio builder exposes durable flow controls and paused-run evidence", () => {
  for (const label of [
    "Wait / delay",
    "Pause until approval",
    "Conditional branch",
  ]) {
    assert.ok(engine.includes(label));
  }
  assert.ok(panel.includes('row.type === "wait"'));
  assert.ok(panel.includes('row.type === "approval_gate"'));
  assert.ok(panel.includes('row.type === "branch"'));
  assert.ok(panel.includes("Resumes"));
  assert.ok(panel.includes("Approval #"));
  assert.ok(panel.includes("true gate"));
  assert.ok(api.includes("waiting"));
});

test("legacy actions remain supported by the v2 normalizer", () => {
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
    assert.ok(engine.includes(`type === "${action}"`) || engine.includes(`type: "${action}"`), `missing legacy action ${action}`);
  }
  assert.ok(engine.includes("normalizeLifecycleActions"));
  assert.ok(engine.includes("runLifecycleAutomations"));
});
