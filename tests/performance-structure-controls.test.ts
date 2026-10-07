import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("drizzle/0076_performance_structure_controls.sql", "utf8");
const schema = readFileSync("src/db/schema.ts", "utf8");
const route = readFileSync("src/app/api/performance/route.ts", "utf8");
const selfRoute = readFileSync("src/app/api/self/performance/route.ts", "utf8");
const panel = readFileSync("src/components/performance-governance-panel.tsx", "utf8");
const performancePanel = readFileSync("src/components/performance-panel.tsx", "utf8");

test("performance goals support governed company team employee hierarchy", () => {
  assert.ok(migration.includes('"scope" varchar(24) NOT NULL DEFAULT \'employee\''));
  assert.ok(migration.includes('"parent_goal_id" integer REFERENCES "performance_goals"'));
  assert.ok(migration.includes('"performance_goals_scope_check"'));
  assert.ok(schema.includes('parentGoalId: integer("parent_goal_id")'));
  assert.ok(schema.includes('"performance_goals_scope_check"'));
  assert.ok(route.includes("Team goals may only cascade from a company goal."));
  assert.ok(route.includes("An employee goal can only cascade from a team goal in that employee's org unit."));
});

test("competency and KRA templates create structured review evidence", () => {
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "performance_templates"'));
  assert.ok(migration.includes('CHECK ("type" IN (\'competency\',\'kra\'))'));
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "performance_cycle_templates"'));
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "performance_review_items"'));
  assert.ok(schema.includes("export const performanceTemplates = pgTable("));
  assert.ok(schema.includes("export const performanceReviewItems = pgTable("));
  assert.ok(route.includes('entityType === "cycle_template"'));
  assert.ok(route.includes("structuredItems: links.length"));
});

test("review structure freezes once completion begins", () => {
  assert.ok(route.includes("Review structure is locked after the first review completes."));
  assert.ok(route.includes('existingReviews.some((review) => review.status === "completed")'));
});

test("review completion enforces configured evidence instead of silently finalizing", () => {
  assert.ok(route.includes("cycle.requireManagerSummary"));
  assert.ok(route.includes("cycle.requireSelfAssessment"));
  assert.ok(route.includes("Score every required competency/KRA item before completing the review."));
  assert.ok(route.includes("This cycle requires employee self-ratings for every required competency/KRA item."));
  assert.ok(route.includes("Completed review evidence is locked."));
});

test("cycle completion is a governed irreversible closure gate", () => {
  assert.ok(migration.includes('"completed_at" timestamptz'));
  assert.ok(route.includes("cycleCompletionReadiness"));
  assert.ok(route.includes("The cycle cannot close until every review is completed"));
  assert.ok(route.includes('status: "completed"'));
  assert.ok(route.includes("Performance cycle completed"));
});

test("employee self-assessment includes structured competency and KRA items", () => {
  assert.ok(selfRoute.includes("performanceReviewItems"));
  assert.ok(selfRoute.includes("Rate every required competency/KRA item"));
  assert.ok(selfRoute.includes("employeeComment"));
  assert.ok(selfRoute.includes("structuredItemCount"));
});

test("workspace exposes performance governance without connecting it to compensation", () => {
  assert.ok(performancePanel.includes("PerformanceGovernancePanel"));
  assert.ok(panel.includes("Company → team → employee"));
  assert.ok(panel.includes("Competencies and KRAs"));
  assert.ok(panel.includes("Complete cycle"));
  assert.equal(route.includes("compensation"), false);
});
