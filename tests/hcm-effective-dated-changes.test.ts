import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("src/db/schema.ts", "utf8");
const migration = readFileSync("drizzle/0052_hcm_effective_dated_changes.sql", "utf8");
const baseline = readFileSync("drizzle/baseline.sql", "utf8");
const route = readFileSync("src/app/api/hcm/effective-changes/route.ts", "utf8");
const apply = readFileSync("src/lib/hcm-effective-changes.ts", "utf8");
const scheduler = readFileSync("src/lib/scheduler.ts", "utf8");
const profile = readFileSync("src/app/api/hcm/worker-profile/route.ts", "utf8");
const people = readFileSync("src/components/workspace/people.tsx", "utf8");
const transfer = readFileSync("src/app/api/workforce-planning/transfer/route.ts", "utf8");
const planning = readFileSync("src/app/api/workforce-planning/route.ts", "utf8");
const separation = readFileSync("src/app/api/separation/route.ts", "utf8");

test("HCM Core 2.2 stores governed effective-dated changes", () => {
  assert.ok(schema.includes('export const workerEffectiveChanges = pgTable('));
  assert.ok(schema.includes('"worker_effective_changes"'));
  assert.ok(schema.includes('targetPositionId: integer("target_position_id")'));
  assert.ok(schema.includes('targetManagerEmployeeId: integer("target_manager_employee_id")'));
  assert.ok(schema.includes('effectiveDate: date("effective_date").notNull()'));
  assert.ok(schema.includes('fromSnapshot: jsonb("from_snapshot")'));
  assert.ok(schema.includes('toSnapshot: jsonb("to_snapshot")'));
  assert.ok(schema.includes("worker_effective_changes_active_employee_unique"));
  assert.ok(schema.includes("worker_effective_changes_active_target_position_unique"));
});

test("migration and fresh baseline include the effective-change ledger", () => {
  for (const source of [migration, baseline]) {
    assert.ok(source.includes('CREATE TABLE IF NOT EXISTS "worker_effective_changes"'));
    assert.ok(source.includes('"requested_by_user_id"'));
    assert.ok(source.includes('"approved_by_user_id"'));
    assert.ok(source.includes('"applied_event_id"'));
    assert.ok(source.includes("worker_effective_changes_active_employee_unique"));
  }
});

test("effective-change requests use company-wide People access and maker-checker approval", () => {
  assert.ok(route.includes("Scheduled effective-dated employment changes require company-wide People access."));
  assert.ok(route.includes("Maker-checker control: the person who requested this employment change cannot approve it."));
  assert.ok(route.includes('status: "pending_approval"'));
  assert.ok(route.includes('status: "scheduled"'));
  assert.ok(route.includes('approvedByUserId: user.id'));
});

test("position moves reserve the vacancy before their effective date", () => {
  assert.ok(route.includes('status: "reserved"'));
  assert.ok(route.includes('eq(positions.status, "approved")'));
  assert.ok(apply.includes('targetPosition.status !== "reserved"'));
  assert.ok(apply.includes('eq(positions.status, "reserved")'));
  assert.ok(apply.includes('status: "filled"'));
  assert.ok(people.includes("Position moves inherit org, supervisory org, legal employer, cost center, manager, and employment type"));
});

test("retroactive changes fail closed when they would rewrite later worker history", () => {
  assert.ok(route.includes("Retroactive position moves are blocked"));
  assert.ok(route.includes("A later employment event already exists."));
  assert.ok(apply.includes("Retroactive position moves are not auto-applied."));
  assert.ok(apply.includes('retroactive: String(change.effectiveDate) < today'));
});

test("due changes are revalidated and applied atomically", () => {
  assert.ok(apply.includes("pg_advisory_xact_lock(4203"));
  assert.ok(apply.includes("pg_advisory_xact_lock(4204"));
  assert.ok(apply.includes("The scheduled operating organization is no longer active."));
  assert.ok(apply.includes("The scheduled manager is no longer an eligible active manager."));
  assert.ok(apply.includes("The target position's legal employer is no longer active."));
  assert.ok(apply.includes('eventType: change.movementType'));
  assert.ok(apply.includes('status: "applied"'));
  assert.ok(apply.includes('appliedEventId: event.id'));
});

test("scheduler applies due effective-dated HCM changes", () => {
  assert.ok(scheduler.includes("runScheduledWorkerEffectiveChanges"));
  assert.ok(scheduler.includes("hcmEffectiveChanges"));
  assert.ok(apply.includes('lte(workerEffectiveChanges.effectiveDate, today)'));
  assert.ok(apply.includes('limit(Math.max(1, Math.min(limit, 100)))'));
});

test("direct worker mutations cannot bypass unresolved scheduled HCM state", () => {
  for (const source of [transfer, planning, separation]) {
    assert.ok(source.includes("workerEffectiveChanges"));
    assert.ok(source.includes('"pending_approval", "scheduled", "failed"'));
  }
  assert.ok(transfer.includes("before using the immediate transfer flow"));
  assert.ok(planning.includes("before direct position assignment"));
  assert.ok(separation.includes("before starting Separation"));
});

test("connected worker profile exposes schedule, approval and failure evidence", () => {
  assert.ok(profile.includes("effectiveChangeRows"));
  assert.ok(profile.includes("availablePositions"));
  assert.ok(profile.includes("changeOptions"));
  assert.ok(profile.includes("pendingEffectiveChanges"));
  assert.ok(people.includes("EFFECTIVE-DATED EMPLOYMENT"));
  assert.ok(people.includes("Submit for approval"));
  assert.ok(people.includes('decideEffectiveChange(change.id, "approve")'));
  assert.ok(people.includes('decideEffectiveChange(change.id, "retry")'));
  assert.ok(people.includes("requested by"));
});

test("post-apply hooks cannot roll back an already committed worker change", () => {
  assert.ok(apply.includes("postApplyWarnings"));
  assert.ok(apply.includes("hcm-obligations:"));
  assert.ok(apply.includes("lifecycle-automation:"));
  const appliedIndex = apply.indexOf('status: "applied"');
  const postApplyIndex = apply.indexOf("postApplyWarnings");
  assert.ok(appliedIndex >= 0 && postApplyIndex > appliedIndex);
});
