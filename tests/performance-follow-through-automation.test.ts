import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("drizzle/0084_performance_follow_through_automation.sql", "utf8");
const schema = readFileSync("src/db/schema.ts", "utf8");
const actionReminders = readFileSync("src/lib/hcm-performance-action-reminders.ts", "utf8");
const scheduler = readFileSync("src/lib/scheduler.ts", "utf8");
const developmentRoute = readFileSync("src/app/api/performance/development-plans/route.ts", "utf8");
const selfDevelopmentRoute = readFileSync("src/app/api/self/performance/development-plans/route.ts", "utf8");
const sealing = readFileSync("src/lib/hcm-performance-evidence-sealing.ts", "utf8");
const governanceRoute = readFileSync("src/app/api/performance/follow-through-governance/route.ts", "utf8");
const evidenceBuilder = readFileSync("src/lib/hcm-performance-evidence.ts", "utf8");
const evidenceRoute = readFileSync("src/app/api/performance/evidence/route.ts", "utf8");
const followThroughPanel = readFileSync("src/components/performance-follow-through-panel.tsx", "utf8");
const selfPanel = readFileSync("src/components/performance-development-self-panel.tsx", "utf8");

test("1:1 action reminders use durable policy task and event ledgers", () => {
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "performance_action_reminder_policies"'));
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "performance_action_item_reminder_tasks"'));
  assert.ok(migration.includes('CREATE UNIQUE INDEX IF NOT EXISTS "performance_action_item_reminder_source_unique"'));
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "performance_action_item_reminder_events"'));
  assert.ok(schema.includes("export const performanceActionReminderPolicies = pgTable("));
  assert.ok(schema.includes("export const performanceActionItemReminderTasks = pgTable("));
});

test("action reminder stages are configurable deduplicated and resolve automatically", () => {
  assert.ok(actionReminders.includes("performanceActionReminderStage"));
  assert.ok(actionReminders.includes("policy.reminderDaysBefore"));
  assert.ok(actionReminders.includes("policy.escalationDaysOverdue"));
  assert.ok(actionReminders.includes('"hcm-performance-action-reminder"'));
  assert.ok(actionReminders.includes('"performance-action-reminder"'));
  assert.ok(actionReminders.includes('reason: "action_completed_cancelled_or_not_due"'));
  assert.ok(actionReminders.includes("notificationEpisode"));
});

test("employee-owned commitments notify managers and escalations can reach company People admins", () => {
  assert.ok(actionReminders.includes("notifyManagerOnEmployeeItem"));
  assert.ok(actionReminders.includes("notifyPeopleAdminOnEscalation"));
  assert.ok(actionReminders.includes('role: "manager"'));
  assert.ok(actionReminders.includes('role: "people_admin"'));
  assert.ok(actionReminders.includes("fallbackPeopleAdmin"));
  assert.ok(actionReminders.includes("roleAllowed(row.role, PEOPLE_ADMIN_ROLES)"));
});

test("action reminders and evidence sealing share the existing scheduler path", () => {
  assert.ok(scheduler.includes("runScheduledPerformanceActionReminders"));
  assert.ok(scheduler.includes("performanceActionReminders"));
  assert.ok(scheduler.includes("runScheduledPerformanceEvidenceSealing"));
  assert.ok(scheduler.includes('"hcm-performance-evidence-sealing"'));
});

test("skill development plans are created only from verified persistent gaps", () => {
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "performance_skill_development_plans"'));
  assert.ok(migration.includes('CREATE UNIQUE INDEX IF NOT EXISTS "performance_skill_development_plan_open_unique"'));
  assert.ok(developmentRoute.includes("persistentGapEvidence"));
  assert.ok(developmentRoute.includes("consecutiveGapCycles >= 2"));
  assert.ok(developmentRoute.includes("A development plan requires a verified persistent skill gap across at least two consecutive completed cycles."));
  assert.ok(developmentRoute.includes("Target proficiency cannot be below the latest frozen role expectation."));
});

test("development plan completion requires milestone closure and cancellations require rationale", () => {
  assert.ok(developmentRoute.includes("Complete or cancel every development milestone before completing the plan."));
  assert.ok(developmentRoute.includes("A cancellation reason of at least 10 characters is required."));
  assert.ok(developmentRoute.includes('"status_changed"'));
  assert.ok(followThroughPanel.includes("Create from evidence"));
  assert.ok(followThroughPanel.includes("Complete plan"));
});

test("employee development self-service is visibility and employee scoped", () => {
  assert.ok(selfDevelopmentRoute.includes("eq(performanceSkillDevelopmentPlans.employeeId, context.employee.id)"));
  assert.ok(selfDevelopmentRoute.includes("eq(performanceSkillDevelopmentPlans.employeeVisible, true)"));
  assert.ok(selfDevelopmentRoute.includes("Closed development plans do not accept new progress updates."));
  assert.ok(selfDevelopmentRoute.includes("Closed milestones can only be reopened by the manager or People administrator."));
  assert.ok(selfPanel.includes("My development plans"));
  assert.ok(selfPanel.includes("Add progress"));
});

test("completed-cycle evidence sealing freezes versioned retention policy and manifest hashes", () => {
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "performance_evidence_policies"'));
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "performance_cycle_evidence_seals"'));
  assert.ok(migration.includes('"manifest_hash" varchar(64) NOT NULL'));
  assert.ok(sealing.includes("buildPerformanceCycleSealManifest"));
  assert.ok(sealing.includes("Only completed performance cycles can be sealed."));
  assert.ok(sealing.includes("policySnapshot: policyState.snapshot"));
  assert.ok(sealing.includes("manifestHash"));
  assert.ok(sealing.includes("retentionUntil"));
});

test("seal verification recomputes current evidence and records match or mismatch", () => {
  assert.ok(sealing.includes("verifyPerformanceCycleSeal"));
  assert.ok(sealing.includes('const status = current.manifestHash === seal.manifestHash ? "match" : "mismatch"'));
  assert.ok(evidenceBuilder.includes("sealVerification"));
  assert.ok(evidenceBuilder.includes("employeeEvidenceMatchesSeal"));
  assert.ok(evidenceRoute.includes("X-Linaw-Performance-Seal-Match"));
});

test("post-seal amendments are append-only tamper-evident chains", () => {
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "performance_cycle_evidence_amendments"'));
  assert.ok(sealing.includes("previousChainHash"));
  assert.ok(sealing.includes("amendmentHash"));
  assert.ok(sealing.includes("chainHash"));
  assert.ok(sealing.includes("latestAmendmentNumber"));
  assert.ok(governanceRoute.includes("Performance evidence amendment appended"));
  assert.ok(governanceRoute.includes("Amendment employee is not in this workspace."));
});

test("evidence policy seal verification legal hold and amendment mutations are company-wide People governed", () => {
  assert.ok(governanceRoute.includes("PEOPLE_ADMIN_ROLES"));
  assert.ok(governanceRoute.includes("access?.companyWide"));
  assert.ok(governanceRoute.includes("requireSensitiveActionMfa(user)"));
  assert.ok(governanceRoute.includes('action === "legal_hold"'));
  assert.ok(governanceRoute.includes('action === "amend_seal"'));
  assert.ok(followThroughPanel.includes("Seal completed performance cycles"));
  assert.ok(followThroughPanel.includes("Apply legal hold"));
});

test("follow-through features remain separated from compensation and payroll mutation", () => {
  assert.equal(actionReminders.includes("basicRate"), false);
  assert.equal(developmentRoute.includes("basicRate"), false);
  assert.equal(selfDevelopmentRoute.includes("basicRate"), false);
  assert.equal(sealing.includes("basicRate"), false);
  assert.equal(governanceRoute.includes("basicRate"), false);
  assert.ok(selfPanel.includes("do not change compensation or payroll"));
});
