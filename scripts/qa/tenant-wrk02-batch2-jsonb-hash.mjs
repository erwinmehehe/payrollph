/**
 * WRK-02 source-hash verification across PostgreSQL JSONB.
 * The unchanged application routes hash insertion-ordered JS objects BEFORE
 * JSONB persistence. PostgreSQL JSONB does not retain JS property ordering.
 * Reconstruct exactly the route's original key order while strictly rejecting
 * any missing, extra or unreviewed fields. These are synthetic-only QA helpers.
 */
import assert from "node:assert/strict";

export function requireExactObjectOrder(value, fields, name = "source object") {
  assert.ok(value && typeof value === "object" && !Array.isArray(value),
    name + " must be an object");
  assert.deepEqual(Object.keys(value).sort(), [...fields].sort(),
    name + " source keys changed; refresh source and security proof");
  return Object.fromEntries(fields.map(key => [key, value[key]]));
}

const of = requireExactObjectOrder;
const DIMS = ["key","requestedHeadcount","approvedHeadcount","filledHeadcount",
  "requestedFte","approvedFte","filledFte","annualPositionBudget"];
const POSITION = ["sourcePositionId","code","jobProfileId","orgUnitId",
  "supervisoryOrgUnitId","legalEntityId","costCenterId","planId",
  "managerEmployeeId","employmentType","status","plannedStartDate",
  "annualBudget","notes"];
const position = row => of(row, POSITION, "position ledger record");
const dimension = row => of(row, DIMS, "headcount dimension");

function headcount(value) {
  const result = of(value, [...DIMS,"vacantApprovedHeadcount","positionIds",
    "dimensions","quality"], "baseline headcount");
  result.dimensions = of(value.dimensions,
    ["orgUnits","costCenters","jobProfiles"], "headcount dimensions");
  for (const key of ["orgUnits","costCenters","jobProfiles"]) {
    assert.ok(Array.isArray(value.dimensions[key]));
    result.dimensions[key] = value.dimensions[key].map(dimension);
  }
  result.quality = of(value.quality,
    ["filledPositionsWithoutActiveAssignment","activeAssignmentsOnNonFilledPositions"],
    "headcount quality");
  return result;
}

/** The exact source literal published by baselines/route.ts POST. */
export function sourceOrderBaseline(value) {
  const row = of(value, ["version","publishedAt","asOf","plan","scenario",
    "scope","headcount","forecast","positionExecutionSource","boundary",
    "planVersion"], "baseline snapshot");
  assert.equal(row.version, "hcm-headcount-baseline-v1");
  // Batch 2's *fictional* approved scenario seeds an empty forecast summary.
  assert.equal(row.forecast, null, "Batch 2 cannot forge a forecast");
  row.plan = of(value.plan, ["id","name","startDate","endDate","budget"], "plan");
  row.scenario = of(value.scenario, ["id","name","version","snapshotHash",
    "startDate","endDate","demandGrowthPercent","vacancyFillPercent",
    "employerLoadPercent","annualAttritionPercent","attritionBackfillPercent"],
    "approved scenario");
  row.scope = of(value.scope, ["orgUnitId","worksiteId","scopeLabel"], "scope");
  row.headcount = headcount(value.headcount);
  row.positionExecutionSource = of(value.positionExecutionSource,
    ["version","positions","positionCount","boundary"], "frozen positions");
  assert.equal(row.positionExecutionSource.version, "hcm-position-execution-source-v1");
  assert.ok(Array.isArray(row.positionExecutionSource.positions));
  row.positionExecutionSource.positions = row.positionExecutionSource.positions.map(position);
  assert.equal(row.positionExecutionSource.positionCount,
    row.positionExecutionSource.positions.length);
  return row;
}

function preview(value) {
  const row = of(value, ["planId","actions","blockers","noops","summary"],
    "position preview");
  assert.ok(Array.isArray(row.actions) && Array.isArray(row.blockers)
    && Array.isArray(row.noops), "Preview must include actual ledger arrays");
  assert.equal(row.blockers.length, 0, "Batch 2 claims blocker-free preview");
  row.actions = row.actions.map(action => {
    assert.ok(action.kind === "update" || action.kind === "create",
      "Unreviewed position operation");
    if (action.kind === "update") {
      const ordered = of(action, ["kind","positionId","code","before","after",
        "changedFields"], "update action");
      ordered.before = position(action.before);
      ordered.after = position(action.after);
      return ordered;
    }
    const ordered = of(action, ["kind","sourcePositionId","code","after"], "create action");
    ordered.after = position(action.after);
    return ordered;
  });
  row.noops = row.noops.map(item => of(item,
    ["positionId","code","status"], "noop"));
  row.summary = of(value.summary, ["baselinePositions","createCount",
    "updateCount","noopCount","blockerCount","executable"], "preview summary");
  assert.equal(row.summary.blockerCount, 0);
  assert.equal(row.summary.executable, true);
  return row;
}

/** The exact 7-field evidence hashed by position-executions/route.ts POST. */
export function sourceOrderExecution(value) {
  const row = of(value, ["version","baselineId","baselineVersion",
    "baselineSnapshotHash","planId","liveStateHash","preview",
    "generatedAt","boundary"], "position execution evidence");
  assert.equal(row.version, "hcm-position-execution-preview-v1");
  assert.ok(typeof row.generatedAt === "string" && row.generatedAt);
  assert.ok(typeof row.boundary === "string" && row.boundary);
  return { version: row.version, baselineId: row.baselineId,
    baselineVersion: row.baselineVersion,
    baselineSnapshotHash: row.baselineSnapshotHash,
    planId: row.planId, liveStateHash: row.liveStateHash,
    preview: preview(row.preview) };
}
