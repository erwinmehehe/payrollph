import assert from "node:assert/strict";
import test from "node:test";
import { checkEmployeeLeaveEligibility } from "../src/lib/hcm-leave-employment";
import { evaluateHcmWorkPeriod } from "../src/lib/hcm-work-period-guard";

const employeeId = 77;
const organizationId = 88;
const hireDate = "2026-01-10";
const lastDay = "2026-09-30";

test("leave and WFM reject pre-hire submissions for the same worker", () => {
  const leave = checkEmployeeLeaveEligibility({
    employeeStatus: "Active", employmentStartDate: hireDate,
    leaveStartDate: "2026-01-09", leaveEndDate: "2026-01-09",
  });
  const work = evaluateHcmWorkPeriod({
    employee: { employeeId, organizationId, status: "Active", startDate: hireDate },
    startDate: "2026-01-09", endDate: "2026-01-09", separation: null,
  });
  assert.equal(leave?.code, "LEAVE_BEFORE_EMPLOYMENT");
  assert.equal(work.ok, false);
  if (!work.ok) assert.equal(work.code, "HCM_WORK_BEFORE_HIRE");
});

test("leave and WFM allow work up to the verified separation day, but not after it", () => {
  for (const [day, allowed] of [["2026-09-30", true], ["2026-10-01", false]] as const) {
    const leave = checkEmployeeLeaveEligibility({
      employeeStatus: "Separating", employmentStartDate: hireDate,
      leaveStartDate: day, leaveEndDate: day, separationLastDay: lastDay,
    });
    const work = evaluateHcmWorkPeriod({
      employee: { employeeId, organizationId, status: "Separating", startDate: hireDate },
      startDate: day, endDate: day,
      separation: { status: "approved", lastDay },
    });
    assert.equal(leave === null, allowed);
    assert.equal(work.ok, allowed);
    if (!allowed) {
      assert.equal(leave?.code, "LEAVE_AFTER_SEPARATION");
      if (!work.ok) assert.equal(work.code, "HCM_WORK_AFTER_LAST_DAY");
    }
  }
});

test("a separated worker cannot use ordinary leave or new WFM authorization", () => {
  const leave = checkEmployeeLeaveEligibility({
    employeeStatus: "Separated", employmentStartDate: hireDate,
    leaveStartDate: "2026-09-29", leaveEndDate: "2026-09-29",
  });
  const work = evaluateHcmWorkPeriod({
    employee: { employeeId, organizationId, status: "Separated", startDate: hireDate },
    startDate: "2026-09-29", endDate: "2026-09-29",
    separation: { status: "released", lastDay },
  });
  assert.equal(leave?.code, "LEAVE_SEPARATED_EMPLOYEE");
  assert.equal(work.ok, false);
  if (!work.ok) assert.equal(work.code, "HCM_WORKER_NOT_ACTIVE");
});
