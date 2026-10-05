import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("src/db/schema.ts", "utf8");
const fromPosition = readFileSync("src/app/api/recruitment/from-position/route.ts", "utf8");
const hire = readFileSync("src/app/api/recruitment/hire/route.ts", "utf8");
const recruitment = readFileSync("src/app/api/recruitment/route.ts", "utf8");
const planningUi = readFileSync("src/components/workforce-planning-panel.tsx", "utf8");
const recruitingUi = readFileSync("src/components/recruitment-panel.tsx", "utf8");

test("requisitions and applicants retain lifecycle links", () => {
  assert.ok(schema.includes('positionId: integer("position_id")'));
  assert.ok(schema.includes('jobProfileId: integer("job_profile_id")'));
  assert.ok(schema.includes('orgUnitId: integer("org_unit_id")'));
  assert.ok(schema.includes('targetStartDate: date("target_start_date")'));
  assert.ok(schema.includes('hiredEmployeeId: integer("hired_employee_id")'));
  assert.ok(schema.includes('hiredAt: timestamp("hired_at"'));
});

test("approved positions can create one governed requisition", () => {
  assert.ok(fromPosition.includes('["approved", "open"].includes(position.status)'));
  assert.ok(fromPosition.includes("This position already has an active requisition."));
  assert.ok(fromPosition.includes('status: "open"'));
  assert.ok(fromPosition.includes("monthlyBudget"));
  assert.ok(fromPosition.includes("db.transaction"));
  assert.ok(fromPosition.includes('"Position opened for recruitment"'));
});

test("candidate hire is an atomic candidate to employee lifecycle transaction", () => {
  assert.ok(hire.includes('applicant.stage !== "offer"'));
  assert.ok(hire.includes("Record the accepted monthly salary before hiring."));
  assert.ok(hire.includes("requisition.positionId"));
  assert.ok(hire.includes("isNull(positionAssignments.effectiveUntil)"));
  assert.ok(hire.includes("db.transaction"));
  assert.ok(hire.includes("tx.insert(employees)"));
  assert.ok(hire.includes("tx.insert(employeePayProfiles)"));
  assert.ok(hire.includes("tx.insert(positionAssignments)"));
  assert.ok(hire.includes("tx.insert(provisioningTasks)"));
  assert.ok(hire.includes('set({ status: "filled"'));
  assert.ok(hire.includes('set({ stage: "hired", hiredEmployeeId: employee.id'));
});

test("salary and vacancy controls fail closed", () => {
  assert.ok(hire.includes("offeredSalary > Number(requisition.salaryMax)"));
  assert.ok(hire.includes("The linked position already has an active incumbent."));
  assert.ok(hire.includes("The linked position is not available for hire."));
  assert.ok(hire.includes("exceeds the approved requisition budget"));
});

test("direct hired stage is blocked outside the lifecycle endpoint", () => {
  assert.ok(recruitment.includes('stage === "hired"'));
  assert.ok(recruitment.includes("Use the hire workflow"));
});

test("planning and recruiting UIs expose the connected flow", () => {
  assert.ok(planningUi.includes('fetch("/api/recruitment/from-position"'));
  assert.ok(planningUi.includes("Open requisition"));
  assert.ok(recruitingUi.includes('fetch("/api/recruitment/hire"'));
  assert.ok(recruitingUi.includes("Hire and start onboarding"));
  assert.ok(recruitingUi.includes("Position required"));
});
