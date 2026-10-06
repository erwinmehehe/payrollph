import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("src/db/schema.ts", "utf8");
const migration = readFileSync("drizzle/0050_hcm_core_worker_history.sql", "utf8");
const baseline = readFileSync("drizzle/baseline.sql", "utf8");
const hire = readFileSync("src/app/api/recruitment/hire/route.ts", "utf8");
const transfer = readFileSync("src/app/api/workforce-planning/transfer/route.ts", "utf8");
const separation = readFileSync("src/app/api/separation/route.ts", "utf8");
const workerProfile = readFileSync("src/app/api/hcm/worker-profile/route.ts", "utf8");
const people = readFileSync("src/components/workspace/people.tsx", "utf8");

test("HCM Core 2.0 makes legal employer part of the authoritative position", () => {
  assert.ok(schema.includes('legalEntityId: integer("legal_entity_id")'));
  assert.ok(schema.includes('index("positions_legal_entity_idx")'));
  assert.ok(migration.includes('ADD COLUMN IF NOT EXISTS "legal_entity_id"'));
  assert.ok(migration.includes('SET "legal_entity_id" = e."legal_entity_id"'));
  assert.ok(hire.includes("legalEntityId: position.legalEntityId"));
  assert.ok(transfer.includes("legalEntityId: targetPosition.legalEntityId ?? employee.legalEntityId"));
});

test("position assignments carry primary-secondary semantics and FTE", () => {
  assert.ok(schema.includes('assignmentType: varchar("assignment_type"'));
  assert.ok(schema.includes('fte: numeric("fte"'));
  assert.ok(schema.includes("position_assignments_active_primary_employee_unique"));
  assert.ok(migration.includes("at most one active primary position assignment per employee"));
  assert.ok(migration.includes('"assignment_type" = \'primary\''));
  assert.ok(hire.includes('assignmentType: "primary"'));
  assert.ok(hire.includes('fte: "1.0000"'));
  assert.ok(transfer.includes("assignmentType: currentAssignment.assignmentType"));
  assert.ok(transfer.includes("fte: currentAssignment.fte"));
});

test("worker employment events are immutable HCM lifecycle evidence", () => {
  assert.ok(schema.includes('export const workerEmploymentEvents = pgTable('));
  assert.ok(schema.includes('"worker_employment_events"'));
  for (const field of [
    "effectiveDate",
    "eventType",
    "positionAssignmentId",
    "fromPositionId",
    "toPositionId",
    "fromOrgUnitId",
    "toOrgUnitId",
    "fromLegalEntityId",
    "toLegalEntityId",
    "fromManagerEmployeeId",
    "toManagerEmployeeId",
    "fromEmploymentType",
    "toEmploymentType",
    "fromStatus",
    "toStatus",
    "actorUserId",
    "actorName",
  ]) {
    assert.ok(schema.includes(field), `worker history missing ${field}`);
  }
  assert.equal(schema.includes("workerEmploymentEvents).set("), false, "worker employment history must stay append-only");
});

test("hire, movement, and separation lifecycle write worker history", () => {
  assert.ok(hire.includes('eventType: "hire"'));
  assert.ok(hire.includes("positionAssignmentId: assignment.id"));
  assert.ok(transfer.includes("eventType: movementType"));
  assert.ok(transfer.includes("fromPositionId: currentPosition.id"));
  assert.ok(transfer.includes("toPositionId: targetPosition.id"));
  assert.ok(separation.includes('eventType: "separation_started"'));
  assert.ok(separation.includes('eventType: "separation_released"'));
});

test("separation release closes the authoritative position assignment", () => {
  assert.ok(separation.includes("eq(positionAssignments.assignmentType, \"primary\")"));
  assert.ok(separation.includes("effectiveUntil: fresh.lastDay"));
  assert.ok(separation.includes('status: "open"'));
  assert.ok(separation.includes("positionClosed: Boolean(activeAssignment)"));
});

test("connected worker profile exposes current assignment and full history", () => {
  assert.ok(workerProfile.includes("assignmentHistoryRows"));
  assert.ok(workerProfile.includes("employmentEventRows"));
  assert.ok(workerProfile.includes("positionHistory"));
  assert.ok(workerProfile.includes("employmentEvents: employmentEventRows"));
  assert.ok(workerProfile.includes("positionAssignments: positionHistory"));
  assert.ok(workerProfile.includes('eq(positionAssignments.assignmentType, "primary")'));
  assert.ok(workerProfile.includes("legalEntity: legalEntityRows[0] ?? null"));
});

test("People UI shows HCM worker history and assignment context", () => {
  assert.ok(people.includes("WORKER HISTORY"));
  assert.ok(people.includes("connectedProfile.history.employmentEvents"));
  assert.ok(people.includes("connectedProfile.history.positionAssignments"));
  assert.ok(people.includes("FTE"));
  assert.ok(people.includes("Legal employer not assigned"));
  assert.ok(people.includes("effective-dated history"));
});

test("fresh-database baseline includes HCM Core 2.0 tables and indexes", () => {
  assert.ok(baseline.includes('CREATE TABLE IF NOT EXISTS "worker_employment_events"'));
  assert.ok(baseline.includes("position_assignments_active_primary_employee_unique"));
  assert.ok(baseline.includes("positions_legal_entity_idx"));
  assert.ok(baseline.includes('"assignment_type" varchar(24)'));
  assert.ok(baseline.includes('"fte" numeric(5,4)'));
});
