import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  actualWorkedMinutes,
  computeWorkforceLaborVariance,
  paidShiftMinutes,
} from "../src/lib/workforce-labor-variance";

test("paid shift minutes handle breaks and overnight shifts", () => {
  assert.equal(paidShiftMinutes({
    id: 1,
    startTime: "08:00",
    endTime: "17:00",
    breakMinutes: 60,
    spansMidnight: false,
  }), 480);

  assert.equal(paidShiftMinutes({
    id: 2,
    startTime: "22:00",
    endTime: "06:00",
    breakMinutes: 60,
    spansMidnight: true,
  }), 420);
});

test("actual worked minutes use explicit breaks and fail visibly on bad attendance", () => {
  const worked = actualWorkedMinutes({
    timeIn: "2026-10-05T00:00:00Z",
    timeOut: "2026-10-05T09:00:00Z",
    breakStart: "2026-10-05T04:00:00Z",
    breakEnd: "2026-10-05T05:00:00Z",
    scheduledBreakMinutes: 30,
  });
  assert.equal(worked.minutes, 480);
  assert.deepEqual(worked.flags, []);

  const incomplete = actualWorkedMinutes({
    timeIn: "2026-10-05T00:00:00Z",
    timeOut: null,
    scheduledBreakMinutes: 60,
  });
  assert.equal(incomplete.minutes, 0);
  assert.deepEqual(incomplete.flags, ["Incomplete punch pair"]);
});

test("required scheduled actual variance reconciles hours and base labor cost", () => {
  const result = computeWorkforceLaborVariance({
    requirements: [{
      id: 1,
      worksiteId: 10,
      workDate: "2026-10-05",
      shiftDefinitionId: 1,
      requiredHeadcount: 2,
    }],
    shifts: [{
      id: 1,
      startTime: "08:00",
      endTime: "17:00",
      breakMinutes: 60,
      spansMidnight: false,
    }],
    scheduled: [
      { employeeId: 1, worksiteId: 10, workDate: "2026-10-05", shiftDefinitionId: 1, paidMinutes: 480, hourlyRate: 100 },
      { employeeId: 2, worksiteId: 10, workDate: "2026-10-05", shiftDefinitionId: 1, paidMinutes: 480, hourlyRate: 200 },
    ],
    actual: [
      { employeeId: 1, worksiteId: 10, workDate: "2026-10-05", shiftDefinitionId: 1, workedMinutes: 420, hourlyRate: 100, matchedToSchedule: true },
      { employeeId: 2, worksiteId: 10, workDate: "2026-10-05", shiftDefinitionId: 1, workedMinutes: 540, hourlyRate: 200, matchedToSchedule: true },
      { employeeId: 3, worksiteId: 10, workDate: "2026-10-05", shiftDefinitionId: null, workedMinutes: 120, hourlyRate: 150, matchedToSchedule: false, flags: ["No schedule match"] },
    ],
    benchmarkHourlyRate: 150,
  });

  const row = result.rows[0];
  assert.equal(row.requiredHours, 16);
  assert.equal(row.scheduledHours, 16);
  assert.equal(row.actualHours, 16);
  assert.equal(row.scheduledCoveragePercent, 100);
  assert.equal(row.actualCoveragePercent, 100);
  assert.equal(row.requiredBaseCost, 2400);
  assert.equal(row.scheduledBaseCost, 2400);
  assert.equal(row.actualBaseCost, 2500);
  assert.equal(row.actualVsScheduledBaseCost, 100);
  assert.equal(row.actualVsRequiredBaseCost, 100);
  assert.equal(row.requiredCostBasis, "scheduled-mix");
  assert.equal(result.summary.unmatchedActualHours, 2);
  assert.equal(result.summary.unmatchedActualBaseCost, 300);
  assert.equal(result.summary.attendanceExceptionCount, 1);
});

test("labor variance exposes understaffing and scheduled work outside demand", () => {
  const result = computeWorkforceLaborVariance({
    requirements: [{
      id: 1,
      worksiteId: 10,
      workDate: "2026-10-05",
      shiftDefinitionId: 1,
      requiredHeadcount: 2,
    }],
    shifts: [
      { id: 1, startTime: "08:00", endTime: "17:00", breakMinutes: 60, spansMidnight: false },
      { id: 2, startTime: "17:00", endTime: "21:00", breakMinutes: 0, spansMidnight: false },
    ],
    scheduled: [
      { employeeId: 1, worksiteId: 10, workDate: "2026-10-05", shiftDefinitionId: 1, paidMinutes: 480, hourlyRate: 100 },
      { employeeId: 2, worksiteId: 10, workDate: "2026-10-05", shiftDefinitionId: 2, paidMinutes: 240, hourlyRate: 100 },
    ],
    actual: [
      { employeeId: 1, worksiteId: 10, workDate: "2026-10-05", shiftDefinitionId: 1, workedMinutes: 450, hourlyRate: 100, matchedToSchedule: true },
    ],
    benchmarkHourlyRate: 100,
  });

  const row = result.rows[0];
  assert.equal(row.scheduledHours, 8);
  assert.equal(row.scheduledVsRequiredHours, -8);
  assert.equal(row.actualHours, 7.5);
  assert.equal(row.actualVsRequiredHours, -8.5);
  assert.equal(result.summary.scheduledOutsideRequirementHours, 4);
});

test("coverage API derives actual labor from matched roster evidence and protects cost visibility", () => {
  const source = readFileSync("src/app/api/workforce/coverage/route.ts", "utf8");
  assert.ok(source.includes("PEOPLE_PAYROLL_ROLES"));
  assert.ok(source.includes("canViewLaborCosts = costDenied === null"));
  assert.ok(source.includes("matchPunchesToWorkforceSegments"));
  assert.ok(source.includes("actualWorkedMinutes"));
  assert.ok(source.includes("computeWorkforceLaborVariance"));
  assert.ok(source.includes("payProfileRows"));
  assert.ok(source.includes("benchmarkHourlyRate: null"));
  assert.ok(source.includes("requiredBaseCost: null"));
  assert.ok(source.includes("laborVariance: laborVarianceResponse"));
});

test("coverage UI shows required scheduled actual labor without requiring cost permission", () => {
  const source = readFileSync("src/components/workspace/workforce-coverage-panel.tsx", "utf8");
  assert.ok(source.includes("Required → scheduled → actual"));
  assert.ok(source.includes("Labor plan variance"));
  assert.ok(source.includes("Labor-cost variance is restricted."));
  assert.ok(source.includes("actual vs required"));
  assert.ok(source.includes("scheduled outside recorded staffing requirements"));
  assert.ok(source.includes("data-wfm-labor-variance"));
});
