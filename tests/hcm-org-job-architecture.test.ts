import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("src/db/schema.ts", "utf8");
const migration = readFileSync("drizzle/0051_hcm_org_job_architecture.sql", "utf8");
const baseline = readFileSync("drizzle/baseline.sql", "utf8");
const planning = readFileSync("src/app/api/workforce-planning/route.ts", "utf8");
const planningUi = readFileSync("src/components/workforce-planning-panel.tsx", "utf8");
const workerProfile = readFileSync("src/app/api/hcm/worker-profile/route.ts", "utf8");
const people = readFileSync("src/components/workspace/people.tsx", "utf8");

test("HCM Core 2.1 normalizes job families levels and grades", () => {
  assert.ok(schema.includes('export const jobFamilies = pgTable('));
  assert.ok(schema.includes('export const jobLevels = pgTable('));
  assert.ok(schema.includes('export const jobGrades = pgTable('));
  assert.ok(schema.includes('familyId: integer("family_id")'));
  assert.ok(schema.includes('levelId: integer("level_id")'));
  assert.ok(schema.includes('gradeId: integer("grade_id")'));
  assert.ok(migration.includes('INSERT INTO "job_families"'));
  assert.ok(migration.includes('INSERT INTO "job_levels"'));
  assert.ok(migration.includes('INSERT INTO "job_grades"'));
  assert.ok(migration.includes('LEGACY-FAM-'));
});

test("organization units carry governed HCM hierarchy context", () => {
  for (const field of [
    'legalEntityId: integer("legal_entity_id")',
    'costCenterId: integer("cost_center_id")',
    'managerEmployeeId: integer("manager_employee_id")',
    'effectiveFrom: date("effective_from")',
    'effectiveUntil: date("effective_until")',
    'active: boolean("active")',
  ]) assert.ok(schema.includes(field), `missing org-unit field ${field}`);
  assert.ok(schema.includes("org_units_org_code_unique"));
  assert.ok(migration.includes("requires organization-unit codes to be unique"));
});

test("positions link operating org supervisory org legal employer and cost center", () => {
  assert.ok(schema.includes('supervisoryOrgUnitId: integer("supervisory_org_unit_id")'));
  assert.ok(schema.includes('costCenterId: integer("cost_center_id")'));
  assert.ok(schema.includes("positions_supervisory_org_idx"));
  assert.ok(schema.includes("positions_cost_center_idx"));
  assert.ok(planning.includes("supervisoryOrgUnitId"));
  assert.ok(planning.includes("legalEntityId"));
  assert.ok(planning.includes("costCenterId"));
  assert.ok(planning.includes("must reference an active supervisory organization"));
});

test("Planning API governs creation of normalized architecture", () => {
  for (const entityType of ["job_family", "job_level", "job_grade", "org_unit"]) {
    assert.ok(planning.includes(`entityType === "${entityType}"`) || planning.includes(`"${entityType}"`), `missing ${entityType}`);
  }
  assert.ok(planning.includes("Organization and job architecture require company-wide People access."));
  assert.ok(planning.includes("Job family created"));
  assert.ok(planning.includes("Job level created"));
  assert.ok(planning.includes("Job grade created"));
  assert.ok(planning.includes("Organization unit created"));
});

test("new job profiles reference structured dimensions instead of free-text input", () => {
  assert.ok(planning.includes("familyId = Number(body.familyId)"));
  assert.ok(planning.includes("levelId = Number(body.levelId)"));
  assert.ok(planning.includes("gradeId = body.gradeId ? Number(body.gradeId) : null"));
  assert.ok(planning.includes("family: family.name"));
  assert.ok(planning.includes("level: level.name"));
  assert.ok(planning.includes("grade: grade?.name ?? null"));
});

test("direct position assignment now respects the authoritative HCM worker model", () => {
  assert.ok(planning.includes("This employee already has an active primary position."));
  assert.ok(planning.includes("Direct assignment changes current worker state"));
  assert.ok(planning.includes("Only active employees can receive a new primary position assignment."));
  assert.ok(planning.includes('assignmentType: "primary"'));
  assert.ok(planning.includes('fte: "1.0000"'));
  assert.ok(planning.includes('eventType: "position_assigned"'));
  assert.ok(planning.includes("workerEmploymentEvents"));
  assert.ok(planning.includes("supervisoryOrgUnitId: position.supervisoryOrgUnitId"));
  assert.ok(planning.includes("costCenterId: position.costCenterId"));
});

test("Planning UI exposes HCM architecture controls", () => {
  assert.ok(planningUi.includes("HCM CORE 2.1"));
  assert.ok(planningUi.includes("Organization &amp; job architecture"));
  assert.ok(planningUi.includes("JOB FAMILY"));
  assert.ok(planningUi.includes("JOB LEVEL"));
  assert.ok(planningUi.includes("JOB GRADE"));
  assert.ok(planningUi.includes("Supervisory organization"));
  assert.ok(planningUi.includes("Legal employer"));
  assert.ok(planningUi.includes("Cost center"));
  assert.ok(planningUi.includes("Families, levels, grades &amp; profiles"));
});

test("connected worker profile exposes supervisory org and cost center", () => {
  assert.ok(workerProfile.includes("supervisoryOrg"));
  assert.ok(workerProfile.includes("costCenter"));
  assert.ok(workerProfile.includes("positionRow.supervisoryOrgUnitId"));
  assert.ok(workerProfile.includes("positionRow.costCenterId"));
  assert.ok(people.includes("No supervisory org"));
  assert.ok(people.includes("No cost center"));
});

test("fresh baseline includes normalized HCM architecture", () => {
  assert.ok(baseline.includes('CREATE TABLE IF NOT EXISTS "job_families"'));
  assert.ok(baseline.includes('CREATE TABLE IF NOT EXISTS "job_levels"'));
  assert.ok(baseline.includes('CREATE TABLE IF NOT EXISTS "job_grades"'));
  assert.ok(baseline.includes('CREATE TABLE IF NOT EXISTS "cost_centers"'));
  assert.ok(baseline.includes('"supervisory_org_unit_id"'));
  assert.ok(baseline.includes("org_units_org_code_unique"));
});
