import assert from "node:assert/strict";
import test from "node:test";
import {
  rosterDateOffset,
  rosterWeekDates,
  summarizeTeamRoster,
  type TeamRosterRow,
} from "../src/lib/workforce-team-roster";

test("Philippine roster week uses ISO calendar days, including leap year and month boundaries", () => {
  assert.deepEqual(rosterWeekDates("2028-02-28"), [
    "2028-02-28", "2028-02-29", "2028-03-01",
    "2028-03-02", "2028-03-03", "2028-03-04", "2028-03-05",
  ]);
  assert.equal(rosterDateOffset("2026-10-05", -7), "2026-09-28");
  assert.equal(rosterDateOffset("2026-12-31", 1), "2027-01-01");
});

test("invalid roster dates never silently roll forward into another day", () => {
  for (const invalid of ["2026-02-29", "2026-13-01", "2026-00-01", "10/09/2026", "", "2026-04-31"]) {
    assert.throws(() => rosterWeekDates(invalid), Error);
  }
  assert.throws(() => rosterDateOffset("2026-10-09", 0.5), Error);
});

function row(days: TeamRosterRow["days"], error: string | null = null): TeamRosterRow {
  return {
    employee: { id: 1, employeeNo: "A001", name: "Test Employee", status: "active", orgUnitId: 1 },
    days,
    error,
  };
}

test("team roster summary counts coverage without treating unassigned work as rest", () => {
  const summary = summarizeTeamRoster([
    row([
      { date: "2026-10-05", source: "pattern", isRestDay: false, worksiteId: 1,
        segments: [{ shiftDefinitionId: 1, shiftCode: "N", startTime: "22:00", endTime: "06:00", breakMinutes: 60, spansMidnight: true }] },
      { date: "2026-10-06", source: "pattern", isRestDay: true, worksiteId: 1, segments: [] },
      { date: "2026-10-07", source: "unassigned", isRestDay: false, worksiteId: null, segments: [] },
    ]),
    row([], "Schedule evidence needs review"),
  ]);
  assert.deepEqual(summary, {
    employees: 2,
    scheduledDays: 1,
    restDays: 1,
    unassignedDays: 1,
    overnightShifts: 1,
    rowsNeedingReview: 1,
  });
});

test("a valid empty result reports zero rather than inventing staffing", () => {
  assert.deepEqual(summarizeTeamRoster([]), {
    employees: 0, scheduledDays: 0, restDays: 0, unassignedDays: 0,
    overnightShifts: 0, rowsNeedingReview: 0,
  });
});
