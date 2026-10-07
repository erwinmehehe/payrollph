import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("src/db/schema.ts", "utf8");
const migration = readFileSync("drizzle/0046_wfm_staffing_scenarios.sql", "utf8");
const compat = readFileSync("src/lib/core-schema-compat.ts", "utf8");
const route = readFileSync("src/app/api/workforce-planning/scenarios/route.ts", "utf8");
const forecastService = readFileSync("src/lib/workforce-forecast-server.ts", "utf8");
const planningRoute = readFileSync("src/app/api/workforce-planning/route.ts", "utf8");
const panel = readFileSync("src/components/workforce-planning-panel.tsx", "utf8");

test("staffing scenarios persist immutable forecast evidence and approval state", () => {
  assert.ok(schema.includes('export const workforcePlanningScenarios = pgTable('));
  assert.ok(schema.includes('"workforce_planning_scenarios"'));
  assert.ok(schema.includes('snapshot: jsonb("snapshot")'));
  assert.ok(schema.includes('snapshotHash: varchar("snapshot_hash"'));
  assert.ok(schema.includes('submittedByUserId: integer("submitted_by_user_id")'));
  assert.ok(schema.includes('decidedByUserId: integer("decided_by_user_id")'));
  assert.ok(schema.includes('scopeOrgUnitId: integer("scope_org_unit_id")'));
  assert.ok(schema.includes('worksiteId: integer("worksite_id")'));
});

test("migration and production compatibility schema carry WFM scenario governance", () => {
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "workforce_planning_scenarios"'));
  assert.ok(migration.includes("workforce_scenarios_status_check"));
  assert.ok(migration.includes("'draft', 'submitted', 'approved', 'rejected'"));
  assert.ok(migration.includes("workforce_scenarios_org_name_version_unique"));
  assert.ok(compat.includes("linaw_core_schema_compat_v18"));
  assert.ok(compat.includes("CREATE TABLE IF NOT EXISTS workforce_planning_scenarios"));
  assert.ok(compat.includes("workforce_scenarios_status_check"));
});

test("scenario snapshots are recalculated server-side and hashed before save", () => {
  assert.ok(route.includes("loadScopedWorkforceForecast"));
  assert.ok(route.includes('createHash("sha256")'));
  assert.ok(route.includes("JSON.stringify(snapshot)"));
  assert.ok(route.includes('version: "wfm-staffing-scenario-v2"'));
  assert.ok(route.includes("snapshotHash: hash"));
  assert.ok(route.includes("Approved scenario evidence is immutable planning data."));
});

test("scenario workflow enforces scoped WFM access and maker-checker review", () => {
  assert.ok(route.includes("WORKFORCE_MANAGER_ROLES"));
  assert.ok(route.includes("scenarioVisibleToAccess"));
  assert.ok(route.includes("APPROVER_ROLES"));
  assert.ok(route.includes('scenario.status !== "draft"'));
  assert.ok(route.includes('scenario.status !== "submitted"'));
  assert.ok(route.includes("scenario.submittedByUserId === user.id"));
  assert.ok(route.includes("Maker-checker control"));
  assert.ok(route.includes('status: "submitted"'));
  assert.ok(route.includes('nextStatus === "approved" ? "approved" : "rejected"'));
});

test("scenario mutations are same-origin protected, demo-safe and audited", () => {
  assert.ok(route.includes("enforceSameOriginMutation(request)"));
  assert.ok(route.includes("publicDemoMutationDenied"));
  assert.ok(route.includes('"Workforce staffing scenario saved"'));
  assert.ok(route.includes('"Workforce staffing scenario submitted"'));
  assert.ok(route.includes('"Workforce staffing scenario approved"'));
  assert.ok(route.includes('"Workforce staffing scenario rejected"'));
});

test("WFM managers can see staffing capacity while payroll-derived costs remain permissioned", () => {
  assert.ok(forecastService.includes("WORKFORCE_MANAGER_ROLES"));
  assert.ok(forecastService.includes("PEOPLE_PAYROLL_ROLES"));
  assert.ok(forecastService.includes("canViewCost"));
  assert.ok(forecastService.includes("redactWorkforceForecastCosts"));
  assert.ok(forecastService.includes("annualizedBasePayroll: null"));
  assert.ok(forecastService.includes("estimatedShiftDemandWageCost: null"));
  assert.ok(route.includes("redactScenarioSnapshot"));
});

test("planning API returns scoped worksites and UI supports scenario scope plus review actions", () => {
  assert.ok(planningRoute.includes("worksites"));
  assert.ok(planningRoute.includes("siteRows.filter"));
  assert.ok(panel.includes("Organization unit"));
  assert.ok(panel.includes("Worksite"));
  assert.ok(panel.includes("Save scenario"));
  assert.ok(panel.includes("STAFFING PLAN APPROVAL"));
  assert.ok(panel.includes('scenarioAction(scenario.id, "submit")'));
  assert.ok(panel.includes('scenarioAction(scenario.id, "approve")'));
  assert.ok(panel.includes('scenarioAction(scenario.id, "reject")'));
  assert.ok(panel.includes("Locked evidence"));
});
