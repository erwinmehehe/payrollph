import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("src/db/schema.ts", "utf8");
const recruitment = readFileSync("src/app/api/recruitment/route.ts", "utf8");
const hire = readFileSync("src/app/api/recruitment/hire/route.ts", "utf8");
const planning = readFileSync("src/app/api/workforce-planning/route.ts", "utf8");
const recruitmentUi = readFileSync("src/components/recruitment-panel.tsx", "utf8");
const planningUi = readFileSync("src/components/workforce-planning-panel.tsx", "utf8");
const workspace = readFileSync("src/components/linaw-workspace.tsx", "utf8");
const migration = readFileSync("drizzle/0043_recruitment_position_handoff.sql", "utf8");

test("recruitment lifecycle retains position and employee lineage", () => {
  assert.ok(schema.includes('positionId: integer("position_id")'));
  assert.ok(schema.includes('hiredEmployeeId: integer("hired_employee_id")'));
  assert.ok(schema.includes('hiredByUserId: integer("hired_by_user_id")'));
  assert.ok(schema.includes('hiredAt: timestamp("hired_at"'));
  assert.ok(schema.includes('"job_applicants_hired_employee_unique"'));
  assert.ok(schema.includes('"job_requisitions_active_position_unique"'));
  assert.ok(schema.includes('"position_assignments_active_position_unique"'));
  assert.ok(migration.includes('ADD COLUMN IF NOT EXISTS "position_id"'));
  assert.ok(migration.includes('"job_requisitions_active_position_unique"'));
  assert.ok(migration.includes('"position_assignments_active_position_unique"'));
  assert.ok(migration.includes("DO $$"));
  assert.ok(migration.includes("END $$;"));
  assert.ok(migration.includes("duplicate active requisitions exist"));
  assert.ok(migration.includes("duplicate active position assignments exist"));
});

test("recruitment and hiring exclude payroll/bookkeeper roles", () => {
  assert.ok(recruitment.includes('const RECRUITMENT_MANAGER_ROLES = ["owner", "admin", "hr"] as const'));
  assert.ok(hire.includes('const RECRUITMENT_MANAGER_ROLES = ["owner", "admin", "hr"] as const'));
  assert.equal(recruitment.includes("PEOPLE_ADMIN_ROLES"), false);
  assert.equal(hire.includes("PEOPLE_ADMIN_ROLES"), false);
});

test("new recruitment demand must originate from an approved position", () => {
  assert.ok(recruitment.includes('"New requisitions must be opened from an approved position in Planning."'));
  assert.ok(recruitment.includes('position.status !== "approved"'));
  assert.ok(recruitment.includes('"Only an approved position can be opened for recruitment."'));
  assert.ok(recruitment.includes("eq(jobRequisitions.positionId, position.id)"));
  assert.ok(recruitment.includes('!["filled", "cancelled"].includes(row.status)'));
  assert.ok(recruitment.includes('"An occupied position cannot be opened for recruitment."'));
  assert.ok(recruitment.includes("pg_advisory_xact_lock(4102"));
  assert.ok(!recruitment.includes('"Legacy requisition created without position"'));
});

test("unit scoped People admins see only position owned recruitment in scope", () => {
  assert.ok(recruitment.includes("visiblePositionIds.has(row.positionId)"));
  assert.ok(recruitment.includes("assertScope(access, linkedPosition.orgUnitId)"));
  assert.ok(recruitment.includes('"This legacy requisition has no org-unit ownership."'));
});

test("candidate intake serializes against a simultaneous position fill", () => {
  assert.ok(recruitment.includes("Candidate application received"));
  assert.ok(recruitment.includes("pg_advisory_xact_lock(4103"));
  assert.ok(recruitment.includes("freshReq.positionId !== req.positionId"));
  assert.ok(recruitment.includes('"This requisition is no longer accepting candidates."'));
  assert.ok(recruitment.includes('"The linked position is no longer open for recruitment."'));
});

test("candidate pipeline is a governed state machine and hired cannot be faked", () => {
  assert.ok(recruitment.includes("CANDIDATE_TRANSITIONS"));
  assert.ok(recruitment.includes('applied: ["screening", "rejected"]'));
  assert.ok(recruitment.includes('interview: ["offer", "rejected"]'));
  assert.ok(recruitment.includes("Candidate cannot move from"));
  assert.ok(recruitment.includes('if (stage === "hired")'));
  assert.ok(recruitment.includes('"Use the Hire & onboard action'));
  assert.ok(recruitment.includes("applicant.hiredEmployeeId"));
  assert.ok(recruitment.includes("pg_advisory_xact_lock(4101"));
  assert.ok(recruitment.includes("pg_advisory_xact_lock(4103"));
  assert.ok(recruitment.includes("freshApplicant.hiredEmployeeId"));
  assert.ok(recruitment.includes('"This requisition is closed and its candidate pipeline is immutable."'));
});

test("job offer requires an amount inside the approved position budget", () => {
  assert.ok(recruitment.includes('"A monthly-equivalent offeredSalary is required before moving a candidate to Job Offer."'));
  assert.ok(recruitment.includes('"The offer exceeds the approved annual position budget."'));
  assert.ok(recruitment.includes("effectiveOffer * 12 > Number(linkedPosition.annualBudget) + 0.01"));
  assert.ok(recruitmentUi.includes("authoritative offer used by Hire & onboard"));
});

test("Hire and onboard requires a linked open vacant position and authoritative offer", () => {
  assert.ok(hire.includes('"Hire & onboard requires a requisition linked to an approved workforce position."'));
  assert.ok(hire.includes('position.status !== "open"'));
  assert.ok(hire.includes('"The linked position already has an active incumbent."'));
  assert.ok(hire.includes('applicant.stage !== "offer"'));
  assert.ok(hire.includes('"A recorded monthly-equivalent offer is required before Hire & onboard."'));
  assert.ok(hire.includes('"The hire pay profile must match the recorded monthly-equivalent offer."'));
  assert.ok(hire.includes('"The recorded offer exceeds the approved annual position budget."'));
});

test("Hire and onboard revalidates state under locks before creating payroll records", () => {
  assert.ok(hire.includes("db.transaction"));
  assert.ok(hire.includes("pg_advisory_xact_lock(4101"));
  assert.ok(hire.includes("pg_advisory_xact_lock(4102"));
  assert.ok(hire.includes("pg_advisory_xact_lock(4103"));
  assert.ok(hire.includes("pg_advisory_xact_lock(4104"));
  assert.ok(hire.includes("pg_advisory_xact_lock(4105"));
  assert.ok(hire.includes("freshApplicant.offeredSalary"));
  assert.ok(hire.includes("freshRequisition.positionId !== position.id"));
  assert.ok(hire.includes('freshPosition.status !== "open"'));
  assert.ok(hire.includes("tx.insert(employees)"));
  assert.ok(hire.includes("tx.insert(employeePayProfiles)"));
  assert.ok(hire.includes("tx.insert(provisioningTasks)"));
  assert.ok(hire.includes("tx.insert(positionAssignments)"));
  assert.ok(hire.includes('stage: "hired"'));
  assert.ok(hire.includes('set({ status: "filled", updatedAt: new Date() })'));
  assert.ok(hire.includes('"Candidate hired and converted to employee"'));
  assert.ok(hire.includes('notInArray(jobApplicants.stage, ["hired", "rejected"])'));
  assert.ok(hire.includes('.set({ stage: "rejected" })'));
  assert.ok(hire.includes("closedCandidateCount"));
});

test("position lifecycle cannot claim open or filled without underlying records", () => {
  assert.ok(planning.includes('status === "open" && !activeRequisition'));
  assert.ok(planning.includes('"A position becomes open only by creating a requisition'));
  assert.ok(planning.includes('status === "filled"'));
  assert.ok(planning.includes('"A position can be marked filled only through an active employee assignment."'));
  assert.ok(planning.includes('set({ status: "cancelled" })'));
  assert.ok(planning.includes("pg_advisory_xact_lock(4102"));
  assert.ok(planning.includes('"This position has an active requisition. Fill it through Recruitment or close the requisition before assigning an incumbent directly."'));
  assert.ok(planning.includes("freshRequisitions"));
  assert.ok(planning.includes("freshPosition.status"));
});

test("Planning owns requisition creation and Recruitment owns candidate conversion", () => {
  assert.ok(planningUi.includes("openRecruitment(position"));
  assert.ok(planningUi.includes("Open requisition"));
  assert.ok(planningUi.includes('onPage("Recruitment")'));
  assert.ok(workspace.includes("onPage={setPage}"));
  assert.ok(recruitmentUi.includes('fetch("/api/recruitment/hire"'));
  assert.ok(recruitmentUi.includes("Hire & onboard"));
  assert.ok(recruitmentUi.includes("New hiring demand starts in"));
  assert.equal(recruitmentUi.includes("Standalone requisition"), false);
});
