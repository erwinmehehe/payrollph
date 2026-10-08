import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildPositionExecutionPreview,
  type WorkforcePlanLivePosition,
  type WorkforcePlanPositionSpec,
} from "../src/lib/workforce-plan-position-execution";

function spec(overrides: Partial<WorkforcePlanPositionSpec> = {}): WorkforcePlanPositionSpec {
  return {
    sourcePositionId: 10,
    code: "FIN-001",
    jobProfileId: 7,
    orgUnitId: 3,
    supervisoryOrgUnitId: null,
    legalEntityId: 2,
    costCenterId: 5,
    planId: 1,
    managerEmployeeId: null,
    employmentType: "Regular",
    status: "planned",
    plannedStartDate: "2026-11-01",
    annualBudget: 600000,
    notes: null,
    ...overrides,
  };
}

function live(overrides: Partial<WorkforcePlanLivePosition> = {}): WorkforcePlanLivePosition {
  return {
    id: 10,
    code: "FIN-001",
    jobProfileId: 7,
    orgUnitId: 3,
    supervisoryOrgUnitId: null,
    legalEntityId: 2,
    costCenterId: 5,
    planId: 1,
    managerEmployeeId: null,
    employmentType: "Regular",
    status: "planned",
    plannedStartDate: "2026-11-01",
    annualBudget: "600000.00",
    notes: null,
    ...overrides,
  };
}

test("published planned position previews an explicit approval change", () => {
  const preview = buildPositionExecutionPreview({
    planId: 1,
    baselinePositions: [spec()],
    livePositions: [live()],
  });

  assert.equal(preview.summary.executable, true);
  assert.equal(preview.summary.updateCount, 1);
  assert.equal(preview.summary.createCount, 0);
  const action = preview.actions[0];
  assert.equal(action?.kind, "update");
  if (action?.kind === "update") {
    assert.deepEqual(action.changedFields, ["status"]);
    assert.equal(action.after.status, "approved");
  }
});

test("missing planned position can be recreated only from frozen published evidence", () => {
  const preview = buildPositionExecutionPreview({
    planId: 1,
    baselinePositions: [spec()],
    livePositions: [],
  });

  assert.equal(preview.summary.executable, true);
  assert.equal(preview.summary.createCount, 1);
  const action = preview.actions[0];
  assert.equal(action?.kind, "create");
  if (action?.kind === "create") {
    assert.equal(action.sourcePositionId, 10);
    assert.equal(action.after.status, "approved");
    assert.equal(action.after.jobProfileId, 7);
    assert.equal(action.after.annualBudget, 600000);
  }
});

test("missing open or filled position cannot be reconstructed without recruitment/incumbency evidence", () => {
  const preview = buildPositionExecutionPreview({
    planId: 1,
    baselinePositions: [spec({ status: "open" })],
    livePositions: [],
  });

  assert.equal(preview.summary.executable, false);
  assert.equal(preview.blockers[0]?.code, "MISSING_NONCREATABLE_POSITION");
});

test("unoccupied planned structural drift can be restored to the published specification", () => {
  const preview = buildPositionExecutionPreview({
    planId: 1,
    baselinePositions: [spec()],
    livePositions: [live({ costCenterId: 9, annualBudget: "700000.00" })],
  });

  assert.equal(preview.summary.executable, true);
  const action = preview.actions[0];
  assert.equal(action?.kind, "update");
  if (action?.kind === "update") {
    assert.deepEqual(action.changedFields, ["costCenterId", "annualBudget", "status"]);
    assert.equal(action.after.costCenterId, 5);
    assert.equal(action.after.annualBudget, 600000);
    assert.equal(action.after.status, "approved");
  }
});

test("occupied or recruiting structural drift fails closed", () => {
  const occupied = buildPositionExecutionPreview({
    planId: 1,
    baselinePositions: [spec()],
    livePositions: [live({ costCenterId: 9 })],
    activeAssignmentPositionIds: [10],
  });
  assert.equal(occupied.summary.executable, false);
  assert.equal(occupied.blockers[0]?.code, "OCCUPIED_POSITION_DRIFT");

  const recruiting = buildPositionExecutionPreview({
    planId: 1,
    baselinePositions: [spec()],
    livePositions: [live({ costCenterId: 9 })],
    activeRequisitionPositionIds: [10],
  });
  assert.equal(recruiting.summary.executable, false);
  assert.equal(recruiting.blockers[0]?.code, "RECRUITING_POSITION_DRIFT");
});

test("position added to a plan after publication blocks exact baseline execution", () => {
  const preview = buildPositionExecutionPreview({
    planId: 1,
    baselinePositions: [spec()],
    livePositions: [
      live(),
      live({ id: 11, code: "FIN-002" }),
    ],
  });

  assert.equal(preview.summary.executable, false);
  assert.ok(preview.blockers.some((blocker) => blocker.code === "UNAPPROVED_PLAN_POSITION"));
});

test("matching positions already advanced downstream remain no-op rather than being rolled back", () => {
  const preview = buildPositionExecutionPreview({
    planId: 1,
    baselinePositions: [spec()],
    livePositions: [live({ status: "open" })],
    activeRequisitionPositionIds: [10],
  });

  assert.equal(preview.summary.executable, true);
  assert.equal(preview.summary.noopCount, 1);
  assert.equal(preview.actions.length, 0);
});

test("published baseline freezes exact position specifications for execution", () => {
  const route = readFileSync("src/app/api/workforce-planning/baselines/route.ts", "utf8");
  assert.ok(route.includes("positionExecutionSource"));
  assert.ok(route.includes('"hcm-position-execution-source-v1"'));
  assert.ok(route.includes("normalizePositionSpec"));
  assert.ok(route.includes("positionExecutionSourceCount"));
});

test("position execution persistence exists in schema, migration, fresh baseline and compatibility path", () => {
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const migration = readFileSync("drizzle/0094_workforce_plan_position_executions.sql", "utf8");
  const baseline = readFileSync("drizzle/baseline.sql", "utf8");
  const compat = readFileSync("src/lib/core-schema-compat.ts", "utf8");

  assert.ok(schema.includes("export const workforcePlanPositionExecutions = pgTable("));
  assert.ok(schema.includes('"workforce_plan_position_executions"'));
  assert.ok(schema.includes('executionHash: varchar("execution_hash"'));
  assert.ok(schema.includes("workforce_plan_position_executions_status_check"));
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "workforce_plan_position_executions"'));
  assert.ok(migration.includes("workforce_plan_position_executions_org_hash_unique"));
  assert.ok(baseline.includes('CREATE TABLE IF NOT EXISTS "workforce_plan_position_executions"'));
  assert.ok(compat.includes("CREATE TABLE IF NOT EXISTS workforce_plan_position_executions"));
});

test("execution API is preview first, company-wide, MFA gated and exact-state revalidated", () => {
  const route = readFileSync("src/app/api/workforce-planning/position-executions/route.ts", "utf8");

  assert.ok(route.includes("enforceSameOriginMutation(request)"));
  assert.ok(route.includes("publicDemoMutationDenied"));
  assert.ok(route.includes("PEOPLE_ADMIN_ROLES"));
  assert.ok(route.includes("access?.companyWide"));
  assert.ok(route.includes("requireSensitiveActionMfa(user)"));
  assert.ok(route.includes("enforceSensitiveActionRateLimit"));
  assert.ok(route.includes('"workforce-position-execution"'));
  assert.ok(route.includes("baseline?.current"));
  assert.ok(route.includes("baseline.snapshotHash !== freshExecution.baselineSnapshotHash"));
  assert.ok(route.includes("liveStateHash"));
  assert.ok(route.includes("hash(evidence) !== freshExecution.executionHash"));
  assert.ok(route.includes("pg_advisory_xact_lock(4194"));
  assert.ok(route.includes("pg_advisory_xact_lock(4102"));
  assert.ok(route.includes("POSITION_EXECUTION_STATE_CHANGED"));
  assert.ok(route.includes("No positions were changed; create a fresh preview."));
});

test("execution mutates positions only and leaves recruitment, incumbency and payroll separate", () => {
  const route = readFileSync("src/app/api/workforce-planning/position-executions/route.ts", "utf8");

  assert.ok(route.includes("tx.insert(positions)"));
  assert.ok(route.includes("tx.update(positions)"));
  assert.ok(route.includes('status: "approved"'));
  assert.equal(route.includes("tx.insert(jobRequisitions)"), false);
  assert.equal(route.includes("tx.insert(positionAssignments)"), false);
  assert.equal(route.includes("tx.insert(employees)"), false);
  assert.equal(route.includes("payrollEntries"), false);
  assert.ok(route.includes("never creates incumbents, requisitions, schedules, attendance or payroll entries"));
});

test("planning workspace exposes preview, blockers, hashes and explicit apply/cancel controls", () => {
  const panel = readFileSync("src/components/workforce-planning-panel.tsx", "utf8");

  assert.ok(panel.includes("CONTROLLED PLAN EXECUTION"));
  assert.ok(panel.includes("Published plan → position ledger"));
  assert.ok(panel.includes("Preview position execution"));
  assert.ok(panel.includes("/api/workforce-planning/position-executions"));
  assert.ok(panel.includes("Apply positions"));
  assert.ok(panel.includes("positionExecutionAction(execution.id, \"cancel\")"));
  assert.ok(panel.includes("positionExecutionAction(execution.id, \"apply\")"));
  assert.ok(panel.includes("execution.executionHash.slice"));
  assert.ok(panel.includes("Applying a published plan requires company-wide People-admin permission"));
});
