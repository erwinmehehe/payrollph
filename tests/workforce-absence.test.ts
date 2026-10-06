import assert from "node:assert/strict";
import test from "node:test";
import {
  approvedLeaveConflictsFullShift,
  approvedLeaveCoverageImpact,
  calendarDaysInclusive,
} from "../src/lib/workforce-absence";

test("full-day leave is explicit only when entered days cover the whole calendar range", () => {
  assert.equal(calendarDaysInclusive("2026-10-06", "2026-10-06"), 1);
  assert.equal(approvedLeaveCoverageImpact({
    id: 1,
    employeeId: 10,
    startDate: "2026-10-06",
    endDate: "2026-10-06",
    days: 1,
  }).kind, "full_day");

  assert.equal(approvedLeaveCoverageImpact({
    id: 2,
    employeeId: 10,
    startDate: "2026-10-06",
    endDate: "2026-10-06",
    days: 0.5,
  }).kind, "ambiguous_partial");
});

test("multi-date working-day totals are not guessed into weekend or shift absences", () => {
  const impact = approvedLeaveCoverageImpact({
    id: 3,
    employeeId: 10,
    startDate: "2026-10-05",
    endDate: "2026-10-11",
    days: 5,
  });
  assert.equal(impact.kind, "ambiguous_partial");
  assert.equal(impact.calendarDays, 7);
});

test("any approved leave overlap blocks claiming a full open shift until timing is compatible", () => {
  const result = approvedLeaveConflictsFullShift({
    employeeId: 10,
    workDate: "2026-10-06",
    leaves: [{
      id: 4,
      employeeId: 10,
      startDate: "2026-10-06",
      endDate: "2026-10-06",
      days: 0.5,
      leaveType: "Vacation",
    }],
  });
  assert.equal(result.conflict, true);
  assert.equal(result.ambiguous, true);
  assert.equal(result.fullDay, false);
});
