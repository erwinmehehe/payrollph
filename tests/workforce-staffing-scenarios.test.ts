import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { workforcePlanApprovalAmount } from "../src/lib/workforce-plan-approval";

const schema = readFileSync("src/db/schema.ts", "utf8");
const migration = readFileSync("drizzle/0046_wfm_staffing_scenarios.sql", "utf8");
const attritionMigration = readFileSync("drizzle/0092_workforce_attrition_backfill.sql", "utf8");
const compat = readFileSync("src/lib/core-schema-compat.ts", "utf8");
const route = readFileSync("src/app/api/workforce-planning/scenarios/route.ts", "utf8");
const forecastService = readFileSync("src/lib/workforce-forecast-server.ts", "utf8");
const planningRoute = readFileSync("src/app/api/workforce-planning/route.ts", "utf8");
const panel = readFileSync("src/components/workforce-planning-panel.tsx", "utf8");
const approvals = readFileSync("src/app/api/approvals/[id]/route.ts", "utf8");

test("staffing scenarios persist immutable forecast evidence and approval state", () => {
  assert.ok(schema.includes('export const workforcePlanningScenarios = pgTable('));
  assert.ok(schema.includes('"workforce_planning_scenarios"'));
  assert.ok(schema.includes('snapshot: jsonb("snapshot")'));
  assert.ok(schema.includes('snapshotHash: varchar("snapshot_hash"'));
  assert.ok(schema.includes('submittedByUserId: integer("submitted_by_user_id")'));
  assert.ok(schema.includes('decidedByUserId: integer("decided_by_user_id")'));
  assert.ok(schema.includes('scopeOrgUnitId: integer("scope_org_unit_id")'));
  assert.ok(schema.includes('worksiteId: integer("worksite_id")'));
  assert.ok(schema.includes('annualAttritionPercent: numeric("annual_attrition_percent"'));
  assert.ok(schema.includes('attritionBackfillPercent: numeric("attrition_backfill_percent"'));
});

test("migration and production compatibility schema carry WFM scenario governance", () => {
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "workforce_planning_scenarios"'));
  assert.ok(migration.includes("workforce_scenarios_status_check"));
  assert.ok(migration.includes("'draft', 'submitted', 'approved', 'rejected'"));
  assert.ok(migration.includes("workforce_scenarios_org_name_version_unique"));
  assert.ok(compat.includes("linaw_core_schema_compat_v19"));
  assert.ok(compat.includes("CREATE TABLE IF NOT EXISTS workforce_planning_scenarios"));
  assert.ok(compat.includes("workforce_scenarios_status_check"));
  assert.ok(attritionMigration.includes("annual_attrition_percent"));
  assert.ok(attritionMigration.includes("attrition_backfill_percent"));
  assert.ok(attritionMigration.includes("workforce_scenarios_annual_attrition_check"));
  assert.ok(attritionMigration.includes("workforce_scenarios_attrition_backfill_check"));
  assert.ok(compat.includes("ADD COLUMN IF NOT EXISTS annual_attrition_percent"));
  assert.ok(compat.includes("ADD COLUMN IF NOT EXISTS attrition_backfill_percent"));
});

test("scenario snapshots are recalculated server-side and hashed before save", () => {
  assert.ok(route.includes("loadScopedWorkforceForecast"));
  assert.ok(route.includes('createHash("sha256")'));
  assert.ok(route.includes("JSON.stringify(snapshot)"));
  assert.ok(route.includes('version: "wfm-staffing-scenario-v3"'));
  assert.ok(route.includes("annualAttritionPercent"));
  assert.ok(route.includes("attritionBackfillPercent"));
  assert.ok(route.includes("expectedAttritionExits"));
  assert.ok(route.includes("plannedAttritionBackfills"));
  assert.ok(route.includes("snapshotHash: hash"));
  assert.ok(route.includes("Approved scenario evidence is immutable planning data."));
});

test("scenario submission starts the configured workforce-plan business process", () => {
  assert.ok(route.includes("WORKFORCE_MANAGER_ROLES"));
  assert.ok(route.includes("scenarioVisibleToAccess"));
  assert.ok(route.includes('eq(approvalChainPolicies.purpose, "workforce_plan")'));
  assert.ok(route.includes("validateApprovalChainSteps"));
  assert.ok(route.includes("approvalStepsForAmount"));
  assert.ok(route.includes("workforcePlanApprovalAmount"));
  assert.ok(route.includes('sourceType: "workforce_plan_scenario"'));
  assert.ok(route.includes("approvalChainInstanceId: instance.id"));
  assert.ok(route.includes('status: "submitted"'));
  assert.ok(route.includes("Workforce-plan approval decisions are completed from Approvals."));
  assert.equal(route.includes('action === "approve"'), false);
  assert.equal(route.includes('action === "reject"'), false);
});

test("scenario mutations are same-origin protected, demo-safe and final decisions are audited by Approvals", () => {
  assert.ok(route.includes("enforceSameOriginMutation(request)"));
  assert.ok(route.includes("publicDemoMutationDenied"));
  assert.ok(route.includes('"Workforce staffing scenario saved"'));
  assert.ok(route.includes('"Workforce staffing scenario submitted"'));
  assert.ok(approvals.includes('"Workforce staffing scenario approved"'));
  assert.ok(approvals.includes('"Workforce staffing scenario rejected"'));
  assert.ok(approvals.includes("workforceScenarioApproval"));
  assert.ok(approvals.includes("WORKFORCE_PLAN_APPROVAL_CONFLICT"));
});

test("WFM managers can see staffing capacity while payroll-derived costs remain permissioned", () => {
  assert.ok(forecastService.includes("WORKFORCE_MANAGER_ROLES"));
  assert.ok(forecastService.includes("PEOPLE_PAYROLL_ROLES"));
  assert.ok(forecastService.includes("canViewCost"));
  assert.ok(forecastService.includes("redactWorkforceForecastCosts"));
  assert.ok(forecastService.includes("annualizedBasePayroll: null"));
  assert.ok(forecastService.includes("estimatedShiftDemandWageCost: null"));
  assert.ok(forecastService.includes("annualBackfillRunRateCost: null"));
  assert.ok(forecastService.includes("backfillPlan: forecast.backfillPlan?.map"));
  assert.ok(route.includes("redactScenarioSnapshot"));
});

test("planning UI submits scenarios into the shared Approvals business process", () => {
  assert.ok(planningRoute.includes("worksites"));
  assert.ok(planningRoute.includes("siteRows.filter"));
  assert.ok(panel.includes("Organization unit"));
  assert.ok(panel.includes("Worksite"));
  assert.ok(panel.includes("Save scenario"));
  assert.ok(panel.includes("Annual attrition %"));
  assert.ok(panel.includes("Attrition backfill %"));
  assert.ok(panel.includes("Governed backfill boundary."));
  assert.ok(panel.includes("STAFFING PLAN APPROVAL"));
  assert.ok(panel.includes('scenarioAction(scenario.id, "submit")'));
  assert.equal(panel.includes('scenarioAction(scenario.id, "approve")'), false);
  assert.equal(panel.includes('scenarioAction(scenario.id, "reject")'), false);
  assert.ok(panel.includes('onPage("Approvals")'));
  assert.ok(panel.includes("incremental annual cost"));
  assert.ok(panel.includes("approvalConfiguration"));
  assert.ok(panel.includes("Locked evidence") || panel.includes("Current baseline"));
});


test("approval routing uses incremental annual labor cost against the published baseline", () => {
  const routed = workforcePlanApprovalAmount({
    scenarioSnapshot: {
      forecast: {
        assumptions: { windowDays: 90 },
        summary: {
          annualRunRateLaborCost: 12_500_000,
          annualizedBasePayroll: 9_000_000,
          currentPeriodStatutoryEmployerCost: 200_000,
          currentPeriodBenefitEmployerCost: 50_000,
          currentPeriodRecurringCompensationCost: 25_000,
        },
      },
    },
    currentBaselineSnapshot: {
      forecast: { annualRunRateLaborCost: 10_000_000 },
    },
  });
  assert.equal(routed.amount, 2_500_000);
  assert.equal(routed.basis, "incremental_annual_labor_cost_vs_published_baseline");
  assert.equal(routed.referenceAnnualLaborCost, 10_000_000);
});

test("first-plan approval routing falls back to current loaded workforce cost", () => {
  const routed = workforcePlanApprovalAmount({
    scenarioSnapshot: {
      forecast: {
        assumptions: { windowDays: 365.25 },
        summary: {
          annualRunRateLaborCost: 12_000_000,
          annualizedBasePayroll: 9_000_000,
          currentPeriodStatutoryEmployerCost: 600_000,
          currentPeriodBenefitEmployerCost: 300_000,
          currentPeriodRecurringCompensationCost: 100_000,
        },
      },
    },
  });
  assert.equal(routed.referenceAnnualLaborCost, 10_000_000);
  assert.equal(routed.amount, 2_000_000);
  assert.equal(routed.basis, "incremental_annual_labor_cost_vs_current_workforce");
});

test("workforce-plan maker-checker is enforced in the shared Approvals engine", () => {
  assert.ok(approvals.includes('instance?.sourceType === "workforce_plan_scenario"'));
  assert.ok(approvals.includes("scenario.submittedByUserId === sessionUser.id"));
  assert.ok(approvals.includes("cannot approve any step of its business process"));
  assert.ok(approvals.includes("chainResult.isChain"));
  assert.ok(approvals.includes("chainResult.final"));
  assert.ok(approvals.includes('chainResult.status === "approved" || chainResult.status === "declined"'));
  assert.ok(approvals.includes('status: nextScenarioStatus'));
});


test("published workforce plan remains authoritative while a revision is in approval", () => {
  assert.ok(route.includes('linkedPlan.status !== "published"'));
  assert.ok(approvals.includes('linkedPlan.status !== "published"'));
  assert.ok(route.includes('status: "submitted"'));
  assert.ok(approvals.includes("nextScenarioStatus"));
});
