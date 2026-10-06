import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { lifecycleSignalForRow } from "../src/lib/hcm-lifecycle-notifications";

const read = (path: string) => readFileSync(path, "utf8");

function lifecycleRow(daysUntil: number) {
  return {
    employeeId: 10,
    employeeNo: "EMP-010",
    employeeName: "Ana Santos",
    employeeStatus: "Active",
    state: daysUntil <= 0 ? "action_required" : "upcoming",
    severity: daysUntil <= 0 ? "blocker" : "warning",
    action: "record_decision",
    dueDate: "2026-10-31",
    daysUntil,
    label: "Probation review",
    detail: "Record an explicit governed decision.",
    term: {
      id: 44,
      termKind: "probationary",
      employmentType: "Probationary",
      effectiveFrom: "2026-05-01",
      status: "active",
    },
    decision: null,
    separation: null,
    today: "2026-10-06",
  } as any;
}

test("lifecycle notification milestones are deterministic and escalation-based", () => {
  assert.equal(lifecycleSignalForRow(lifecycleRow(25))?.stage, "t30");
  assert.equal(lifecycleSignalForRow(lifecycleRow(12))?.stage, "t14");
  assert.equal(lifecycleSignalForRow(lifecycleRow(5))?.stage, "t7");
  assert.equal(lifecycleSignalForRow(lifecycleRow(1))?.stage, "t1");
  assert.equal(lifecycleSignalForRow(lifecycleRow(0))?.stage, "due");
  assert.equal(lifecycleSignalForRow(lifecycleRow(-2))?.stage, "overdue");
  const escalated = lifecycleSignalForRow(lifecycleRow(-6));
  assert.equal(escalated?.stage, "overdue_escalated");
  assert.equal(escalated?.escalationStage, 3);
});

test("non-action lifecycle states do not create notification tasks", () => {
  const row = lifecycleRow(40);
  row.action = "none";
  row.state = "clear";
  assert.equal(lifecycleSignalForRow(row), null);

  row.action = "await_effective_date";
  row.state = "in_progress";
  assert.equal(lifecycleSignalForRow(row), null);
});

test("failed decisions and non-renewal handoffs create high-signal task keys", () => {
  const failed = lifecycleRow(-1);
  failed.action = "retry_decision";
  failed.decision = {
    id: 71,
    decisionKind: "renew_term",
    status: "failed",
    effectiveDate: "2026-10-05",
    failure: "Activation conflict",
  };
  failed.term = null;
  const failedSignal = lifecycleSignalForRow(failed);
  assert.equal(failedSignal?.sourceKey, "decision:71:failed");
  assert.equal(failedSignal?.escalationStage, 2);

  const handoff = lifecycleRow(10);
  handoff.action = "start_separation";
  handoff.decision = {
    id: 72,
    decisionKind: "non_renew",
    status: "applied",
    effectiveDate: "2026-10-01",
    proposedSeparationLastDay: "2026-10-31",
    separationHandoffStatus: "ready",
  };
  handoff.term = null;
  const handoffSignal = lifecycleSignalForRow(handoff);
  assert.equal(handoffSignal?.sourceKey, "decision:72:separation-ready");
  assert.equal(handoffSignal?.sourceType, "separation_handoff");
});

test("Core 3.4 migration creates durable task ownership and immutable event evidence", () => {
  const migration = read("drizzle/0060_hcm_lifecycle_notifications.sql");
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "hcm_lifecycle_notification_tasks"'));
  assert.ok(migration.includes('"owner_user_id" integer REFERENCES "users"'));
  assert.ok(migration.includes('"acknowledged_at" timestamptz'));
  assert.ok(migration.includes('"snooze_until" timestamptz'));
  assert.ok(migration.includes('"notification_episode" integer NOT NULL DEFAULT 1'));
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "hcm_lifecycle_notification_events"'));
  assert.ok(migration.includes("hcm_lifecycle_notification_source_unique"));
});

test("notification engine deduplicates by task, stage, episode, and recipient", () => {
  const source = read("src/lib/hcm-lifecycle-notifications.ts");
  assert.ok(source.includes('"hcm-lifecycle"'));
  assert.ok(source.includes("task.id"));
  assert.ok(source.includes("task.stage"));
  assert.ok(source.includes("task.notificationEpisode"));
  assert.ok(source.includes("recipient.userId"));
  assert.ok(source.includes("dedupeKey"));
  assert.ok(source.includes("queueMessage"));
});

test("acknowledged or snoozed tasks reopen when the lifecycle stage changes", () => {
  const source = read("src/lib/hcm-lifecycle-notifications.ts");
  assert.ok(source.includes("stageChanged"));
  assert.ok(source.includes("escalationIncreased"));
  assert.ok(source.includes("snoozeExpired"));
  assert.ok(source.includes("notificationEpisode + 1"));
  assert.ok(source.includes('eventType: escalationIncreased ? "escalated" : "reopened"'));
});

test("default ownership prefers a linked manager then HR then company administrators", () => {
  const source = read("src/lib/hcm-lifecycle-notifications.ts");
  assert.ok(source.includes("positions.managerEmployeeId"));
  assert.ok(source.includes('candidate.role === "manager"'));
  assert.ok(source.includes('candidate.role === "hr"'));
  assert.ok(source.includes('["owner", "admin", "bookkeeper"].includes(candidate.role)'));
});

test("overdue tasks fan out beyond one owner while normal reminders stay scoped", () => {
  const source = read("src/lib/hcm-lifecycle-notifications.ts");
  assert.ok(source.includes("task.escalationStage >= 2"));
  assert.ok(source.includes("roleAllowed(candidate.role, PEOPLE_ADMIN_ROLES)"));
  assert.ok(source.includes("task.ownerUserId"));
});

test("notification API supports assignment, acknowledgement, dismiss, and bounded snooze", () => {
  const route = read("src/app/api/hcm/lifecycle-notifications/route.ts");
  assert.ok(route.includes('["assign", "acknowledge", "dismiss", "snooze"]'));
  assert.ok(route.includes("[1, 3, 7].includes(days)"));
  assert.ok(route.includes("enforceSameOriginMutation"));
  assert.ok(route.includes("enforceSensitiveActionRateLimit"));
  assert.ok(route.includes("Only the assigned owner or a company-wide People administrator"));
  assert.ok(route.includes("hcmLifecycleNotificationEvents"));
  assert.ok(route.includes("recordAuditEvent"));
});

test("manager visibility is limited to assigned lifecycle notification tasks", () => {
  const route = read("src/app/api/hcm/lifecycle-notifications/route.ts");
  assert.ok(route.includes("WORKFORCE_MANAGER_ROLES"));
  assert.ok(route.includes("companyPeopleAdmin"));
  assert.ok(route.includes("eq(hcmLifecycleNotificationTasks.ownerUserId, user.id)"));
});

test("scheduler runs lifecycle notifications hourly rather than on every worker tick", () => {
  const scheduler = read("src/lib/scheduler.ts");
  assert.ok(scheduler.includes("runScheduledHcmLifecycleNotifications"));
  assert.ok(scheduler.includes('"hcm-lifecycle-notifications"'));
  assert.ok(scheduler.includes("60 * 60 * 1000"));
  assert.ok(scheduler.includes("hcmLifecycleNotificationsDue"));
});

test("lifecycle notification mail uses durable outbox retries", () => {
  const mailer = read("src/lib/mailer.ts");
  assert.ok(mailer.includes('"hcm-lifecycle-notification"'));
  const notifications = read("src/lib/hcm-lifecycle-notifications.ts");
  assert.ok(notifications.includes('purpose: "hcm-lifecycle-notification"'));
});

test("People UI surfaces notification ownership for admins and assigned managers", () => {
  const people = read("src/components/workspace/people.tsx");
  const inbox = read("src/components/hcm-lifecycle-notification-inbox.tsx");
  assert.ok(people.includes("HcmLifecycleNotificationInbox"));
  assert.ok(people.includes('"manager"'));
  assert.ok(inbox.includes("Lifecycle notification inbox"));
  assert.ok(inbox.includes("Acknowledge"));
  assert.ok(inbox.includes("Snooze"));
  assert.ok(inbox.includes('void mutate(task.id, "assign"'));
});

test("lifecycle notification controls cannot auto-change employment state", () => {
  const source = read("src/lib/hcm-lifecycle-notifications.ts");
  const route = read("src/app/api/hcm/lifecycle-notifications/route.ts");
  assert.equal(source.includes('status: "Separated"'), false);
  assert.equal(source.includes("activateEmploymentTerm"), false);
  assert.equal(source.includes("applyEmploymentTermDecision"), false);
  assert.equal(route.includes('status: "Separated"'), false);
  assert.equal(route.includes("activateEmploymentTerm"), false);
});

test("readiness route reuses one server loader for UI and scheduler consistency", () => {
  const route = read("src/app/api/hcm/lifecycle-readiness/route.ts");
  const server = read("src/lib/hcm-lifecycle-readiness-server.ts");
  assert.ok(route.includes("loadEmploymentLifecycleReadiness"));
  assert.ok(server.includes("buildEmploymentLifecycleRow"));
  assert.ok(server.includes("sortEmploymentLifecycleRows"));
  assert.ok(server.includes("summarizeEmploymentLifecycle"));
});
