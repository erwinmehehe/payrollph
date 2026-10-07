import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("drizzle/0082_performance_one_on_one_inheritance_trends.sql", "utf8");
const schema = readFileSync("src/db/schema.ts", "utf8");
const performanceRoute = readFileSync("src/app/api/performance/route.ts", "utf8");
const competencyRoute = readFileSync("src/app/api/performance/competencies/route.ts", "utf8");
const competencyPanel = readFileSync("src/components/performance-competency-architecture-panel.tsx", "utf8");
const continuousRoute = readFileSync("src/app/api/performance/continuous/route.ts", "utf8");
const selfRoute = readFileSync("src/app/api/self/performance/route.ts", "utf8");
const continuityPanel = readFileSync("src/components/performance-continuity-panel.tsx", "utf8");
const selfPanel = readFileSync("src/components/hcm-self-performance.tsx", "utf8");
const analytics = readFileSync("src/app/api/performance/analytics/route.ts", "utf8");

test("family and level competency defaults are tenant-scoped and require an explicit scope", () => {
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "hcm_skill_expectation_defaults"'));
  assert.ok(migration.includes('"hcm_skill_expectation_defaults_scope_check"'));
  assert.ok(migration.includes('COALESCE("job_family_id", 0)'));
  assert.ok(migration.includes('COALESCE("job_level_id", 0)'));
  assert.ok(schema.includes("export const hcmSkillExpectationDefaults = pgTable("));
  assert.ok(schema.includes("hcm_skill_expectation_defaults_proficiency_check"));
});

test("review evidence snapshots expectation provenance rather than resolving inheritance later", () => {
  assert.ok(migration.includes('ADD COLUMN IF NOT EXISTS "expectation_source"'));
  assert.ok(migration.includes('ADD COLUMN IF NOT EXISTS "expectation_rule_id"'));
  assert.ok(schema.includes('expectationSource: varchar("expectation_source"'));
  assert.ok(schema.includes('expectationRuleId: integer("expectation_rule_id")'));
  assert.ok(performanceRoute.includes("expectationSource: expectation?.expectationSource ?? null"));
  assert.ok(performanceRoute.includes("expectationRuleId: expectation?.expectationRuleId ?? null"));
});

test("competency expectation precedence is deterministic: profile then family-level then level then family", () => {
  assert.ok(performanceRoute.includes('expectationSource === "family_level" ? 3 : expectationSource === "level" ? 2 : 1'));
  assert.ok(performanceRoute.includes('expectationSource: "profile"'));
  assert.ok(performanceRoute.includes("specificity: 4"));
  assert.ok(competencyRoute.includes('precedence: ["profile", "family_level", "level", "family"]'));
  assert.ok(competencyPanel.includes("Precedence is profile override → family + level → level → family."));
});

test("People admins can create and update inherited competency defaults", () => {
  assert.ok(competencyRoute.includes('entityType === "expectation_default"'));
  assert.ok(competencyRoute.includes("Inherited competency expectation created"));
  assert.ok(competencyRoute.includes("Inherited competency expectation updated"));
  assert.ok(competencyPanel.includes("INHERITED DEFAULTS"));
  assert.ok(competencyPanel.includes("Profile requirements override inherited values."));
});

test("employee 1:1 agenda contributions are append-only, employee-bound, and locked with the meeting", () => {
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "performance_one_on_one_agenda_contributions"'));
  assert.ok(schema.includes("export const performanceOneOnOneAgendaContributions = pgTable("));
  assert.ok(selfRoute.includes("Employee contributed 1:1 agenda item"));
  assert.ok(selfRoute.includes("eq(performanceOneOnOnes.employeeId, context.employee.id)"));
  assert.ok(selfRoute.includes('meeting.status !== "scheduled"'));
  assert.equal(selfRoute.includes("db.update(performanceOneOnOneAgendaContributions)"), false);
  assert.equal(selfRoute.includes("db.delete(performanceOneOnOneAgendaContributions)"), false);
});

test("manager and employee views both show employee-contributed agenda items without exposing private notes", () => {
  assert.ok(continuousRoute.includes("agendaContributions"));
  assert.ok(continuityPanel.includes("Employee agenda contributions"));
  assert.ok(selfPanel.includes("Share agenda item"));
  assert.ok(selfPanel.includes("It remains separate from manager-private notes."));
  assert.equal(selfRoute.includes("privateManagerNotes: performanceOneOnOnes.privateManagerNotes"), false);
});

test("performance analytics expose completed-cycle trends inside the existing employee scope", () => {
  assert.ok(analytics.includes('filter((item) => item.status === "completed")'));
  assert.ok(analytics.includes("const visibleReviews = allReviews.filter"));
  assert.ok(analytics.includes("cycleTrends"));
  assert.ok(analytics.includes("finalScoreDelta"));
  assert.ok(analytics.includes("goalAttainmentDelta"));
  assert.ok(analytics.includes("roleExpectationGapRateDelta"));
  assert.ok(continuityPanel.includes("MULTI-CYCLE TREND"));
  assert.ok(continuityPanel.includes("Deltas compare each cycle with the previous completed cycle."));
});

test("continuity, inheritance, and trend features remain separated from compensation and payroll mutation", () => {
  assert.equal(selfRoute.includes("basicRate"), false);
  assert.equal(continuousRoute.includes("basicRate"), false);
  assert.equal(competencyRoute.includes("compensation"), false);
  assert.equal(analytics.includes("basicRate"), false);
});
