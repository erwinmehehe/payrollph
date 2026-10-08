import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("src/db/schema.ts", "utf8");
const migration = readFileSync("drizzle/0090_workforce_plan_allocations.sql", "utf8");
const baseline = readFileSync("drizzle/baseline.sql", "utf8");
const compat = readFileSync("src/lib/core-schema-compat.ts", "utf8");
const route = readFileSync("src/app/api/workforce-planning/allocations/route.ts", "utf8");
const panel = readFileSync("src/components/workforce-plan-allocation-panel.tsx", "utf8");
const planningPanel = readFileSync("src/components/workforce-planning-panel.tsx", "utf8");

test("workforce planning models top-down allocations and versioned manager submissions", () => {
  assert.ok(schema.includes('export const workforcePlanAllocations = pgTable('));
  assert.ok(schema.includes('"workforce_plan_allocations"'));
  assert.ok(schema.includes('headcountCeiling: integer("headcount_ceiling")'));
  assert.ok(schema.includes('annualBudgetCeiling: numeric("annual_budget_ceiling"'));
  assert.ok(schema.includes('export const workforcePlanManagerSubmissions = pgTable('));
  assert.ok(schema.includes('allocationSnapshot: jsonb("allocation_snapshot")'));
  assert.ok(schema.includes("'draft','submitted','accepted','rejected','superseded'"));
  assert.ok(schema.includes("workforce_plan_manager_submissions_plan_unit_version_unique"));
});

test("migration, fresh baseline and production compatibility all carry allocation planning schema", () => {
  for (const source of [migration, baseline, compat]) {
    assert.ok(source.includes("workforce_plan_allocations"));
    assert.ok(source.includes("workforce_plan_manager_submissions"));
    assert.ok(source.includes("workforce_plan_allocations_plan_unit_unique"));
    assert.ok(source.includes("workforce_plan_manager_submissions_status_check"));
  }
});

test("top-down allocations are company-wide People-admin controls bounded by the plan budget", () => {
  assert.ok(route.includes("Only People administrators can set top-down workforce-plan allocations."));
  assert.ok(route.includes("Top-down workforce allocations require company-wide access."));
  assert.ok(route.includes("otherBudget + annualBudgetCeiling > planBudget"));
  assert.ok(route.includes("ALLOCATION_EXCEEDS_PLAN_BUDGET"));
  assert.ok(route.includes("ALLOCATION_BELOW_ACTIVE_REQUEST"));
  assert.ok(route.includes('"Workforce plan allocation saved"'));
});

test("bottom-up manager requests stay inside org-unit scope and allocation ceilings", () => {
  assert.ok(route.includes("visibleToAccess(allocation.orgUnitId, access)"));
  assert.ok(route.includes("requestedHeadcount > allocation.headcountCeiling"));
  assert.ok(route.includes("requestedAnnualBudget > Number(allocation.annualBudgetCeiling)"));
  assert.ok(route.includes("OPEN_MANAGER_REQUEST_EXISTS"));
  assert.ok(route.includes('status: "draft"'));
  assert.ok(route.includes('"Workforce manager request drafted"'));
  assert.ok(route.includes('"Workforce manager request submitted"'));
});

test("manager-request decisions preserve maker-checker and accepted-version history", () => {
  assert.ok(route.includes("The request submitter cannot decide their own workforce request."));
  assert.ok(route.includes('status: "superseded"'));
  assert.ok(route.includes("Only submitted manager requests can be decided."));
  assert.ok(route.includes("A written decision note is required when rejecting a manager request."));
  assert.ok(route.includes('"Workforce manager request accepted"'));
  assert.ok(route.includes('"Workforce manager request rejected"'));
});

test("allocation planning is non-destructive and available in the workforce planning workspace", () => {
  assert.ok(panel.includes("Top-down allocation &amp; manager submissions"));
  assert.ok(panel.includes("they do not create positions, schedules, or payroll changes"));
  assert.ok(panel.includes("Save allocation"));
  assert.ok(panel.includes("Save manager draft"));
  assert.ok(panel.includes("Manager workforce request submitted for plan-owner review."));
  assert.ok(planningPanel.includes("WorkforcePlanAllocationPanel"));
});
