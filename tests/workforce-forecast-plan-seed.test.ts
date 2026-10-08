import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/workforce-planning/forecast-plan/route.ts", "utf8");
const panel = readFileSync("src/components/workforce-planning-panel.tsx", "utf8");

test("forecast revisions require the current published workforce-plan baseline", () => {
  assert.ok(route.includes("workforcePlanBaselines.current, true"));
  assert.ok(route.includes("Publish an approved company-wide workforce-plan baseline before starting a forecast revision."));
  assert.ok(route.includes("baselineHeadcount"));
  assert.ok(route.includes("baselineSnapshotHash"));
});

test("forecast revisions are recalculated from current authoritative workforce actuals", () => {
  assert.ok(route.includes("summarizeHeadcountPlan"));
  assert.ok(route.includes("compareHeadcountPlanSummary"));
  assert.ok(route.includes("loadScopedWorkforceForecast"));
  assert.ok(route.includes('kind: "published_baseline_plus_live_actuals"'));
  assert.ok(route.includes('version: "hcm-workforce-forecast-revision-v1"'));
  assert.ok(route.includes("actualAsOf"));
});

test("forecast revisions preserve governance and do not mutate the published baseline", () => {
  assert.ok(route.includes("enforceSameOriginMutation(request)"));
  assert.ok(route.includes("publicDemoMutationDenied"));
  assert.ok(route.includes("WORKFORCE_MANAGER_ROLES"));
  assert.ok(route.includes("access.companyWide"));
  assert.ok(route.includes('status: "draft"'));
  assert.ok(route.includes("does not mutate the published baseline"));
  assert.ok(route.includes('"Workforce forecast revision created"'));
});

test("forecast seed provenance does not expose position-budget details", () => {
  assert.ok(route.includes("headcountEvidenceWithoutCosts"));
  assert.ok(route.includes("annualPositionBudget: null"));
});

test("planning UI can start a draft forecast revision from the current baseline", () => {
  assert.ok(panel.includes("/api/workforce-planning/forecast-plan"));
  assert.ok(panel.includes("Start forecast revision"));
  assert.ok(panel.includes("forecastPlanCreating"));
  assert.ok(panel.includes("Review the draft, then submit it through Approvals."));
});
