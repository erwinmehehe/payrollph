import assert from "node:assert/strict";
import test from "node:test";
import { segmentPayableTime, payableTimeEvidenceFlagsForPayroll } from "../src/lib/workforce-payroll";
import { evaluateHcmWorkPeriod } from "../src/lib/hcm-work-period-guard";
import { checkEmployeeLeaveEligibility } from "../src/lib/hcm-leave-employment";

// Integration-only synthetic tests. No database, live payroll, money movement,
// employee personal data, runtime flag changes, or government filing.
test("WFM pricing evidence and HCM employment bounds both reject an oversized exited-worker punch", () => {
  const pricing = segmentPayableTime({
    punch: {
      id: 1,
      workDate: "2026-10-05",
      timeIn: "2026-10-05T00:00:00.000Z",
      timeOut: "2026-10-14T00:00:00.000Z",
    },
    shift: { start: "08:00", end: "17:00", breakMinutes: 0 },
  });
  assert.equal(pricing.allocationComplete, false);
  assert.ok(payableTimeEvidenceFlagsForPayroll(pricing, 9 * 24 * 60)
    .some(flag => flag.startsWith("WFM_PREMIUM_ALLOCATION_UNVERIFIED:")));

  const employment = evaluateHcmWorkPeriod({
    employee: {
      employeeId: 1,
      organizationId: 777,
      status: "Separating",
      startDate: "2026-01-01",
    },
    startDate: "2026-10-05",
    endDate: "2026-10-14",
    separation: { status: "approved", lastDay: "2026-10-07" },
  });
  assert.deepEqual(employment.ok, false);
  assert.equal(employment.ok ? "" : employment.code, "HCM_WORK_AFTER_LAST_DAY");

  const leave = checkEmployeeLeaveEligibility({
    employeeStatus: "Separating",
    employmentStartDate: "2026-01-01",
    leaveStartDate: "2026-10-05",
    leaveEndDate: "2026-10-14",
    separationLastDay: "2026-10-07",
  });
  assert.equal(leave?.code, "LEAVE_AFTER_SEPARATION");
});

test("WFM and HCM both preserve valid within-employment ordinary work", () => {
  const pricing = segmentPayableTime({
    punch: {
      id: 2,
      workDate: "2026-10-05",
      timeIn: "2026-10-05T00:00:00.000Z",
      timeOut: "2026-10-05T01:00:00.000Z",
    },
    shift: { start: "08:00", end: "17:00", breakMinutes: 0 },
  });
  assert.equal(pricing.allocationComplete, true);
  assert.equal(pricing.segments.reduce((total, segment) => total + segment.minutes, 0), 60);
  assert.deepEqual(payableTimeEvidenceFlagsForPayroll(pricing, 60), []);

  const employment = evaluateHcmWorkPeriod({
    employee: {
      employeeId: 2,
      organizationId: 777,
      status: "Active",
      startDate: "2026-01-01",
    },
    startDate: "2026-10-05",
    endDate: "2026-10-05",
    separation: null,
  });
  assert.deepEqual(employment, { ok: true });

  assert.equal(checkEmployeeLeaveEligibility({
    employeeStatus: "Active",
    employmentStartDate: "2026-01-01",
    leaveStartDate: "2026-10-05",
    leaveEndDate: "2026-10-05",
  }), null);
});
