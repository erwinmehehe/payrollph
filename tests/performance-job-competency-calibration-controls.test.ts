import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("drizzle/0080_performance_job_competency_calibration_controls.sql", "utf8");
const schema = readFileSync("src/db/schema.ts", "utf8");
const performanceRoute = readFileSync("src/app/api/performance/route.ts", "utf8");
const competencyRoute = readFileSync("src/app/api/performance/competencies/route.ts", "utf8");
const competencyPanel = readFileSync("src/components/performance-competency-architecture-panel.tsx", "utf8");
const selfRoute = readFileSync("src/app/api/self/performance/route.ts", "utf8");
const selfPanel = readFileSync("src/components/hcm-self-performance.tsx", "utf8");
const calibrationRoute = readFileSync("src/app/api/performance/calibration/route.ts", "utf8");
const calibrationLib = readFileSync("src/lib/hcm-performance-calibration.ts", "utf8");
const calibrationPanel = readFileSync("src/components/performance-calibration-panel.tsx", "utf8");
const analytics = readFileSync("src/app/api/performance/analytics/route.ts", "utf8");

test("performance competencies map to HCM skills and freeze role expectations into review evidence", () => {
  assert.ok(migration.includes('ADD COLUMN IF NOT EXISTS "skill_id" integer REFERENCES "hcm_skills"'));
  assert.ok(migration.includes('ADD COLUMN IF NOT EXISTS "expected_proficiency" integer'));
  assert.ok(migration.includes('"performance_review_items_skill_idx"'));
  assert.ok(schema.includes('skillId: integer("skill_id")'));
  assert.ok(schema.includes('expectedProficiency: integer("expected_proficiency")'));
  assert.ok(performanceRoute.includes("reviewStructureForEmployee"));
  assert.ok(performanceRoute.includes("minimumProficiency"));
  assert.ok(performanceRoute.includes("expectedProficiency: requirement?.minimumProficiency ?? null"));
});

test("mandatory job-profile skills must be represented in the review cycle before a review opens", () => {
  assert.ok(performanceRoute.includes("missingMandatorySkills"));
  assert.ok(performanceRoute.includes("mandatory skills that are not represented by competency templates attached to this review cycle"));
  assert.ok(performanceRoute.includes('row.template!.jobProfileId == null || row.template!.jobProfileId === jobProfileId'));
  assert.ok(performanceRoute.includes('template.type === "competency"'));
});

test("review-specific required snapshots preserve job-profile and optional-cycle semantics", () => {
  assert.ok(migration.includes('SET\n  "required" = pct."required"'));
  assert.ok(migration.includes('"weight" = pct."weight"'));
  assert.ok(performanceRoute.includes("item.required"));
  assert.ok(selfRoute.includes("items.filter((row) => row.required)"));
  assert.ok(selfPanel.includes("role expectation"));
});

test("People admins can govern skill requirements and competency mappings", () => {
  assert.ok(competencyRoute.includes("Job-profile competency architecture requires company-wide access."));
  assert.ok(competencyRoute.includes('entityType === "skill"'));
  assert.ok(competencyRoute.includes('entityType === "requirement"'));
  assert.ok(competencyRoute.includes('entityType === "template_mapping"'));
  assert.ok(competencyPanel.includes("Turn job architecture into review expectations"));
  assert.ok(competencyPanel.includes("COMPETENCY → SKILL MAPPING"));
});

test("calibration distribution policy is versioned and snapshotted per session", () => {
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "performance_calibration_policies"'));
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "performance_calibration_policy_events"'));
  assert.ok(migration.includes('"policy_snapshot" jsonb'));
  assert.ok(schema.includes("export const performanceCalibrationPolicies = pgTable("));
  assert.ok(calibrationRoute.includes("expectedVersion"));
  assert.ok(calibrationRoute.includes("policySnapshot: sessionPolicy"));
  assert.ok(calibrationRoute.includes("policyVersion: sessionPolicy.version"));
  assert.ok(calibrationPanel.includes("Existing sessions keep their frozen policy snapshot."));
});

test("manager distribution and large score changes create durable calibration flags", () => {
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "performance_calibration_flags"'));
  assert.ok(calibrationLib.includes("manager_mean_outlier"));
  assert.ok(calibrationLib.includes("high_rating_concentration"));
  assert.ok(calibrationLib.includes("low_rating_concentration"));
  assert.ok(calibrationLib.includes("large_score_change"));
  assert.ok(calibrationRoute.includes("createCalibrationDistributionFlags"));
  assert.ok(calibrationRoute.includes("syncLargeScoreChangeFlag"));
});

test("large-score-change flags reopen when the flagged delta changes after closure", () => {
  assert.ok(calibrationLib.includes("observedChanged"));
  assert.ok(calibrationLib.includes('status: observedChanged ? "open" : existing.status'));
  assert.ok(calibrationLib.includes("resolvedAt: observedChanged ? null"));
});

test("open outlier flags can block finalization until explicitly accepted or resolved", () => {
  assert.ok(calibrationRoute.includes("Resolve or explicitly accept every calibration outlier flag before finalization."));
  assert.ok(calibrationRoute.includes('eq(performanceCalibrationFlags.status, "open")'));
  assert.ok(calibrationRoute.includes('["accepted", "resolved"].includes(status)'));
  assert.ok(calibrationPanel.includes("Accept with rationale"));
  assert.ok(calibrationPanel.includes("Resolve"));
});

test("analytics expose role competency gaps and calibration flag backlog", () => {
  assert.ok(analytics.includes("belowRoleExpectation"));
  assert.ok(analytics.includes("roleCompetencyItems"));
  assert.ok(analytics.includes("openFlags"));
  assert.ok(analytics.includes("acceptedFlags"));
  assert.ok(analytics.includes("resolvedFlags"));
});

test("job competency and calibration governance never mutate compensation or payroll", () => {
  assert.equal(competencyRoute.includes("basicRate"), false);
  assert.equal(calibrationRoute.includes("basicRate"), false);
  assert.equal(calibrationLib.includes("compensation"), false);
});
