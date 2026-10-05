import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("src/db/schema.ts", "utf8");
const recruitment = readFileSync("src/app/api/recruitment/route.ts", "utf8");
const hire = readFileSync("src/app/api/recruitment/hire/route.ts", "utf8");
const planning = readFileSync("src/app/api/workforce-planning/route.ts", "utf8");
const recruitmentUi = readFileSync("src/components/recruitment-panel.tsx", "utf8");
const planningUi = readFileSync("src/components/workforce-planning-panel.tsx", "utf8");

test("requisitions retain position history and applicants retain employee conversion identity", () => {
  assert.ok(schema.includes('positionId: integer("position_id")'));
  assert.ok(schema.includes('hiredEmployeeId: integer("hired_employee_id")'));
  assert.ok(schema.includes('hiredByUserId: integer("hired_by_user_id")'));
  assert.ok(schema.includes('hiredAt: timestamp("hired_at"'));
  assert.ok(!schema.includes('requisitionId: integer("requisition_id").unique()'));
});

test("approved positions are the governed entry point into recruitment", () => {
  assert.ok(recruitment.includes('position.status !== "approved"'));
  assert.ok(recruitment.includes('"Only an approved position can be opened for recruitment."'));
  assert.ok(recruitment.includes("eq(jobRequisitions.positionId, position.id)"));
  assert.ok(recruitment.includes('!["filled", "cancelled"].includes(row.status)'));
  assert.ok(recruitment.includes('positionId: position.id'));
  assert.ok(recruitment.includes('status: "open"'));
  assert.ok(recruitment.includes('"Approved position opened for recruitment"'));
  assert.ok(recruitment.includes("pg_advisory_xact_lock(4102"));
});

test("unit-scoped HR sees only position-owned requisitions in their scope", () => {
  assert.ok(recruitment.includes("visiblePositionIds.has(row.positionId)"));
  assert.ok(recruitment.includes("assertScope(access, linkedPosition.orgUnitId)"));
  assert.ok(recruitment.includes('"This legacy requisition has no org-unit ownership."'));
});

test("generic candidate movement cannot fake a completed hire", () => {
  assert.ok(recruitment.includes('if (stage === "hired")'));
  assert.ok(recruitment.includes('"Use the Hire & onboard action'));
  assert.ok(recruitment.includes("applicant.hiredEmployeeId"));
});

test("Hire and onboard is a single governed conversion", () => {
  assert.ok(hire.includes('applicant.stage !== "offer"'));
  assert.ok(hire.includes('"A candidate must be in the Job Offer stage'));
  assert.ok(hire.includes("applicant.hiredEmployeeId"));
  assert.ok(hire.includes("payProfile.monthlyEquivalent * 12 > annualBudget"));
  assert.ok(hire.includes("db.transaction"));
  assert.ok(hire.includes("pg_advisory_xact_lock(4101"));
  assert.ok(hire.includes("pg_advisory_xact_lock(4102"));
  assert.ok(hire.includes("tx.insert(employees)"));
  assert.ok(hire.includes("tx.insert(employeePayProfiles)"));
  assert.ok(hire.includes("tx.insert(provisioningTasks)"));
  assert.ok(hire.includes("tx.insert(positionAssignments)"));
  assert.ok(hire.includes('stage: "hired"'));
  assert.ok(hire.includes('status: "filled"'));
  assert.ok(hire.includes('"Candidate hired and converted to employee"'));
});

test("position state cannot claim recruiting or filled without its underlying records", () => {
  assert.ok(planning.includes('status === "open" && !activeRequisition'));
  assert.ok(planning.includes('"A position becomes open only by creating a requisition'));
  assert.ok(planning.includes('status === "filled"'));
  assert.ok(planning.includes('"A position can be marked filled only through an active employee assignment."'));
  assert.ok(planning.includes('set({ status: "cancelled" })'));
  assert.ok(planning.includes("pg_advisory_xact_lock(4102"));
  assert.ok(schema.includes('"position_assignments_active_position_unique"'));
});

test("Planning and Recruitment expose the end-to-end handoff", () => {
  assert.ok(planningUi.includes("openRecruitment(position"));
  assert.ok(planningUi.includes('onPage("Recruitment")'));
  assert.ok(planningUi.includes("Open requisition"));
  assert.ok(recruitmentUi.includes('fetch("/api/recruitment/hire"'));
  assert.ok(recruitmentUi.includes("Hire & onboard"));
  assert.ok(recruitmentUi.includes("assigned to"));
});
