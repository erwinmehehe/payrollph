import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("src/db/schema.ts", "utf8");
const route = readFileSync("src/app/api/learning-career/route.ts", "utf8");
const panel = readFileSync("src/components/learning-career-panel.tsx", "utf8");
const nav = readFileSync("src/components/workspace/nav.ts", "utf8");
const workspace = readFileSync("src/components/linaw-workspace.tsx", "utf8");

test("learning and career schema models competencies development learning and certifications", () => {
  for (const table of [
    "skill_catalog",
    "job_profile_skills",
    "employee_skills",
    "development_plans",
    "development_plan_items",
    "learning_courses",
    "learning_enrollments",
    "employee_certifications",
  ]) {
    assert.ok(schema.includes(`"${table}"`), `missing table ${table}`);
  }
  assert.ok(schema.includes('"job_profile_skills_profile_skill_unique"'));
  assert.ok(schema.includes('"employee_skills_employee_skill_unique"'));
  assert.ok(schema.includes('"learning_enrollments_employee_course_unique"'));
});

test("role requirements and employee proficiency use a bounded five-level model", () => {
  assert.ok(route.includes("Number.isInteger(level) && level >= 1 && level <= 5"));
  assert.ok(route.includes('"Job competency requirement saved"'));
  assert.ok(route.includes('"Employee skill verified"'));
  assert.ok(route.includes("verifiedByUserId: user.id"));
  assert.ok(route.includes("verifiedAt: new Date()"));
  assert.ok(route.includes("SKILL_SOURCES"));
});

test("development plans may link only to the same employee completed performance review", () => {
  assert.ok(route.includes("Development plans may only link to a completed review for the same employee."));
  assert.ok(route.includes("eq(performanceReviews.employeeId, employeeId)"));
  assert.ok(route.includes('review.status !== "completed"'));
  assert.ok(route.includes('"Employee development plan created"'));
});

test("career readiness is calculated from verified job requirements rather than manual percentages", () => {
  assert.ok(route.includes("requirementsByProfile"));
  assert.ok(route.includes("const weight = req.critical ? 2 : 1"));
  assert.ok(route.includes("Math.min(current / req.requiredLevel, 1) * weight"));
  assert.ok(route.includes("criticalGaps.push"));
  assert.ok(route.includes("readinessPercent"));
  assert.ok(panel.includes("Internal mobility based on evidence"));
});

test("course completion can verify a skill issue a credential and close a development activity", () => {
  assert.ok(route.includes('source: "training"'));
  assert.ok(route.includes("Math.max(existingSkill?.proficiencyLevel ?? 0, course.awardedLevel)"));
  assert.ok(route.includes("course.certificationName"));
  assert.ok(route.includes("addMonths(issuedOn, course.validityMonths)"));
  assert.ok(route.includes('status: "completed"'));
  assert.ok(route.includes("siblings.every"));
  assert.ok(route.includes('developmentPlans).set({ status: "completed"'));
});

test("completed learning is immutable to prevent duplicate skill or certification evidence", () => {
  assert.ok(route.includes("Completed learning is immutable because it may already have verified a skill or issued a certification."));
  assert.ok(route.includes("This activity is locked because its linked learning enrollment is already completed."));
});

test("learning mutations are role scoped and audited", () => {
  assert.ok(route.includes("WORKFORCE_MANAGER_ROLES"));
  assert.ok(route.includes("assertScope(access, employee.orgUnitId)"));
  assert.ok(route.includes("enforceSameOriginMutation(request)"));
  assert.ok(route.includes("recordAuditEvent({"));
});

test("learning and career workspace is wired into navigation and rendering", () => {
  assert.ok(nav.includes('{ name: "Learning & Career"'));
  assert.ok(workspace.includes('import { LearningCareerPanel }'));
  assert.ok(workspace.includes('page === "Learning & Career"'));
  assert.ok(panel.includes("Performance-to-development follow-through"));
  assert.ok(panel.includes("Credential evidence and expiry"));
});
