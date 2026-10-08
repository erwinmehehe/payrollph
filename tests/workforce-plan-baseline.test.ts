import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  compareHeadcountPlanDimensions,
  compareHeadcountPlanSummary,
  summarizeHeadcountPlan,
} from "../src/lib/workforce-plan-baseline";

test("headcount plan summary separates requested approved filled and FTE", () => {
  const summary = summarizeHeadcountPlan({
    planId: 7,
    asOf: "2026-10-07",
    positions: [
      { id: 1, planId: 7, jobProfileId: 11, orgUnitId: 101, costCenterId: 201, status: "planned", annualBudget: "500000" },
      { id: 2, planId: 7, jobProfileId: 11, orgUnitId: 101, costCenterId: 201, status: "approved", annualBudget: "600000" },
      { id: 3, planId: 7, jobProfileId: 12, orgUnitId: 102, costCenterId: 202, status: "open", annualBudget: "700000" },
      { id: 4, planId: 7, jobProfileId: 12, orgUnitId: 102, costCenterId: 202, status: "filled", annualBudget: "800000" },
      { id: 5, planId: 7, jobProfileId: 13, orgUnitId: 103, costCenterId: 203, status: "frozen", annualBudget: "900000" },
      { id: 6, planId: 7, jobProfileId: 13, orgUnitId: 103, costCenterId: 203, status: "closed", annualBudget: "1000000" },
      { id: 7, planId: 8, jobProfileId: 13, orgUnitId: 103, costCenterId: 203, status: "filled", annualBudget: "1100000" },
    ],
    assignments: [
      { positionId: 4, fte: "0.7500", effectiveFrom: "2026-01-01", effectiveUntil: null },
      { positionId: 3, fte: "1.0000", effectiveFrom: "2025-01-01", effectiveUntil: "2026-09-30" },
    ],
  });

  assert.equal(summary.requestedHeadcount, 5);
  assert.equal(summary.approvedHeadcount, 3);
  assert.equal(summary.filledHeadcount, 1);
  assert.equal(summary.vacantApprovedHeadcount, 2);
  assert.equal(summary.requestedFte, 5);
  assert.equal(summary.approvedFte, 3);
  assert.equal(summary.filledFte, 0.75);
  assert.equal(summary.annualPositionBudget, 3_500_000);
  assert.deepEqual(summary.positionIds, [1, 2, 3, 4, 5]);
  assert.equal(summary.dimensions.orgUnits.length, 3);
});

test("headcount plan summary reports position-assignment integrity issues", () => {
  const summary = summarizeHeadcountPlan({
    planId: 1,
    asOf: "2026-10-07",
    positions: [
      { id: 10, planId: 1, jobProfileId: 1, orgUnitId: 1, costCenterId: 1, status: "filled", annualBudget: 100 },
      { id: 11, planId: 1, jobProfileId: 1, orgUnitId: 1, costCenterId: 1, status: "approved", annualBudget: 100 },
    ],
    assignments: [
      { positionId: 11, fte: 1, effectiveFrom: "2026-01-01", effectiveUntil: null },
    ],
  });

  assert.deepEqual(summary.quality.filledPositionsWithoutActiveAssignment, [10]);
  assert.deepEqual(summary.quality.activeAssignmentsOnNonFilledPositions, [11]);
});

test("plan-vs-actual comparison returns auditable deltas", () => {
  const baseline = summarizeHeadcountPlan({
    planId: 1,
    asOf: "2026-01-01",
    positions: [
      { id: 1, planId: 1, jobProfileId: 1, orgUnitId: 1, costCenterId: 1, status: "approved", annualBudget: 100 },
      { id: 2, planId: 1, jobProfileId: 1, orgUnitId: 1, costCenterId: 1, status: "filled", annualBudget: 100 },
    ],
    assignments: [
      { positionId: 2, fte: 1, effectiveFrom: "2025-01-01", effectiveUntil: null },
    ],
  });
  const actual = summarizeHeadcountPlan({
    planId: 1,
    asOf: "2026-10-07",
    positions: [
      { id: 1, planId: 1, jobProfileId: 1, orgUnitId: 1, costCenterId: 1, status: "filled", annualBudget: 100 },
      { id: 2, planId: 1, jobProfileId: 1, orgUnitId: 1, costCenterId: 1, status: "filled", annualBudget: 100 },
      { id: 3, planId: 1, jobProfileId: 2, orgUnitId: 1, costCenterId: 2, status: "planned", annualBudget: 200 },
    ],
    assignments: [
      { positionId: 1, fte: 1, effectiveFrom: "2026-05-01", effectiveUntil: null },
      { positionId: 2, fte: 1, effectiveFrom: "2025-01-01", effectiveUntil: null },
    ],
  });

  assert.deepEqual(compareHeadcountPlanSummary(baseline, actual), {
    requestedHeadcount: 1,
    approvedHeadcount: 0,
    filledHeadcount: 1,
    vacantApprovedHeadcount: -1,
    requestedFte: 1,
    approvedFte: 0,
    filledFte: 1,
    annualPositionBudget: 200,
  });
});


test("dimension comparison includes baseline-only and live-only rows with budget deltas", () => {
  const rows = compareHeadcountPlanDimensions(
    [
      {
        key: 10,
        requestedHeadcount: 2,
        approvedHeadcount: 2,
        filledHeadcount: 1,
        requestedFte: 2,
        approvedFte: 2,
        filledFte: 1,
        annualPositionBudget: 1_000_000,
      },
      {
        key: 20,
        requestedHeadcount: 1,
        approvedHeadcount: 1,
        filledHeadcount: 1,
        requestedFte: 1,
        approvedFte: 1,
        filledFte: 1,
        annualPositionBudget: 500_000,
      },
    ],
    [
      {
        key: 10,
        requestedHeadcount: 3,
        approvedHeadcount: 2,
        filledHeadcount: 2,
        requestedFte: 3,
        approvedFte: 2,
        filledFte: 1.5,
        annualPositionBudget: 1_300_000,
      },
      {
        key: 30,
        requestedHeadcount: 1,
        approvedHeadcount: 0,
        filledHeadcount: 0,
        requestedFte: 1,
        approvedFte: 0,
        filledFte: 0,
        annualPositionBudget: 300_000,
      },
    ],
  );

  assert.deepEqual(rows.map((row) => row.key), [10, 20, 30]);
  assert.equal(rows[0].variance.requestedHeadcount, 1);
  assert.equal(rows[0].variance.filledFte, 0.5);
  assert.equal(rows[0].variance.annualPositionBudget, 300_000);
  assert.equal(rows[1].actual.requestedHeadcount, 0);
  assert.equal(rows[1].variance.annualPositionBudget, -500_000);
  assert.equal(rows[2].baseline.requestedHeadcount, 0);
  assert.equal(rows[2].variance.annualPositionBudget, 300_000);
});

test("published baseline persistence exists in schema migration and compatibility path", () => {
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const migration = readFileSync("drizzle/0086_workforce_plan_baselines.sql", "utf8");
  const compat = readFileSync("src/lib/core-schema-compat.ts", "utf8");

  assert.ok(schema.includes("export const workforcePlanBaselines = pgTable("));
  assert.ok(schema.includes('"workforce_plan_baselines"'));
  assert.ok(schema.includes('snapshotHash: varchar("snapshot_hash"'));
  assert.ok(schema.includes('publishedByUserId: integer("published_by_user_id")'));
  assert.ok(schema.includes('supersededAt: timestamp("superseded_at"'));
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "workforce_plan_baselines"'));
  assert.ok(migration.includes('"workforce_plan_baselines_scenario_unique"'));
  assert.ok(compat.includes("CREATE TABLE IF NOT EXISTS workforce_plan_baselines"));
});

test("publishing requires approved company-wide evidence and creates a locked version", () => {
  const route = readFileSync("src/app/api/workforce-planning/baselines/route.ts", "utf8");

  assert.ok(route.includes('scenario.status !== "approved"'));
  assert.ok(route.includes("scenario.scopeOrgUnitId != null || scenario.worksiteId != null"));
  assert.ok(route.includes("PEOPLE_ADMIN_ROLES"));
  assert.ok(route.includes("access?.companyWide"));
  assert.ok(route.includes("for update"));
  assert.ok(route.includes("SCENARIO_ALREADY_PUBLISHED"));
  assert.ok(route.includes("current: false"));
  assert.ok(route.includes("supersededAt: publishedAt"));
  assert.ok(route.includes('status: "published"'));
  assert.ok(route.includes('"hcm-headcount-baseline-v1"'));
  assert.ok(route.includes("snapshotHash = hash(snapshot)"));
  assert.ok(route.includes('"Workforce plan baseline published"'));
  assert.ok(route.includes("annualAttritionPercent: Number(scenario.annualAttritionPercent)"));
  assert.ok(route.includes("attritionBackfillPercent: Number(scenario.attritionBackfillPercent)"));
  assert.ok(route.includes("expectedAttritionExits"));
  assert.ok(route.includes("plannedAttritionBackfills"));
});

test("baseline reads reconcile locked plan evidence against current actuals with cost redaction", () => {
  const route = readFileSync("src/app/api/workforce-planning/baselines/route.ts", "utf8");

  assert.ok(route.includes("summarizeHeadcountPlan"));
  assert.ok(route.includes("compareHeadcountPlanSummary"));
  assert.ok(route.includes("compareHeadcountPlanDimensions"));
  assert.ok(route.includes("orgUnitById"));
  assert.ok(route.includes("costCenterById"));
  assert.ok(route.includes("dimensionVariance"));
  assert.ok(route.includes("PEOPLE_PAYROLL_ROLES"));
  assert.ok(route.includes("redactSummaryCosts"));
  assert.ok(route.includes("redactDimensionVarianceCosts"));
  assert.ok(route.includes("annualPositionBudget: null"));
  assert.ok(route.includes("row.current"));
});

test("planning UI publishes baselines and drills plan variance down by org unit and cost center", () => {
  const panel = readFileSync("src/components/workforce-planning-panel.tsx", "utf8");

  assert.ok(panel.includes("PUBLISHED HEADCOUNT PLAN"));
  assert.ok(panel.includes("Baseline vs live workforce"));
  assert.ok(panel.includes('fetch("/api/workforce-planning/baselines"'));
  assert.ok(panel.includes("Publish baseline"));
  assert.ok(panel.includes("Publish new baseline"));
  assert.ok(panel.includes("Current baseline"));
  assert.ok(panel.includes("PLAN VS ACTUAL DRILLDOWN"));
  assert.ok(panel.includes("Budget variance by org unit &amp; cost center"));
  assert.ok(panel.includes('renderDimensionTable("ORGANIZATION UNIT"'));
  assert.ok(panel.includes('renderDimensionTable("COST CENTER"'));
  assert.ok(panel.includes("Budget amounts are restricted for your role."));
  assert.ok(panel.includes("signedPeso(row.variance.annualPositionBudget)"));
});

test("approved and published plans remain executable in workforce demand handoff", () => {
  const route = readFileSync("src/app/api/workforce-planning/demand-handoff/route.ts", "utf8");
  const panel = readFileSync("src/components/workforce-planning-panel.tsx", "utf8");

  assert.ok(route.includes('["active", "approved", "published"].includes(plan.status)'));
  assert.ok(panel.includes('["active", "approved", "published"].includes(plan.status)'));
});
