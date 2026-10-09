import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTeamRosterPageCsv,
  filterTeamRosterRows,
  rosterDateOffset,
  rosterRowNeedsAttention,
  rosterWeekDates,
  summarizeTeamRoster,
  summarizeTeamRosterByDate,
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

test("manager digest distinguishes scheduled, rest, unassigned and unverified evidence", () => {
  const dates = rosterWeekDates("2026-10-05");
  const shifts: TeamRosterRow["days"] = dates.map((date, index) => ({
    date, source: "pattern", isRestDay: false, worksiteId: 10,
    segments: [{ shiftDefinitionId: 2, shiftCode: "NIGHT", startTime: "22:00",
      endTime: "06:00", breakMinutes: 60, spansMidnight: index === 2 }],
  }));
  const restAndUnassigned: TeamRosterRow["days"] = dates.map((date, index) => ({
    date, source: index === 1 ? "unassigned" : "pattern",
    isRestDay: index !== 1, worksiteId: 10, segments: [],
  }));
  const rows = [row(shifts), row(restAndUnassigned), row([], "Evidence is missing")];
  const days = summarizeTeamRosterByDate(rows, dates);
  assert.equal(days.length, 7);
  assert.deepEqual(days[0], {
    date: dates[0], scheduledEmployees: 1, restEmployees: 1,
    unassignedEmployees: 0, overnightSegments: 0, needsReviewEmployees: 1,
  });
  assert.equal(days[1].unassignedEmployees, 1);
  assert.equal(days[1].restEmployees, 0);
  assert.equal(days[1].needsReviewEmployees, 2);
  assert.equal(days[2].overnightSegments, 1);
  assert.equal(filterTeamRosterRows(rows, dates, "attention").length, 2);
  assert.equal(filterTeamRosterRows(rows, dates, "overnight").length, 1);
  assert.equal(filterTeamRosterRows(rows, dates, "all").length, 3);
});

test("incomplete or duplicated dates are flagged instead of counted as valid shifts", () => {
  const dates = rosterWeekDates("2026-10-05");
  const one: TeamRosterRow["days"][number] = {
    date: dates[0], source: "pattern", isRestDay: false, worksiteId: null,
    segments: [{ shiftDefinitionId: 2, shiftCode: "AM", startTime: "08:00",
      endTime: "16:00", breakMinutes: 60, spansMidnight: false }],
  };
  const duplicated = row([one, one]);
  assert.equal(rosterRowNeedsAttention(duplicated, dates), true);
  const digest = summarizeTeamRosterByDate([duplicated], dates);
  assert.equal(digest[0].scheduledEmployees, 0);
  assert.equal(digest[0].needsReviewEmployees, 1);
  assert.equal(digest[1].needsReviewEmployees, 1);
  const csv = buildTeamRosterPageCsv([duplicated], dates);
  assert.ok(csv.includes("Evidence unavailable"));
  assert.ok(csv.includes("Needs review"));
  assert.throws(() => summarizeTeamRosterByDate([duplicated], [...dates].reverse()));
});

test("CSV export is strictly page-scoped, includes seven dates, and neutralizes spreadsheet formulas", () => {
  const dates = rosterWeekDates("2026-10-05");
  const malicious = row(dates.map((date) => ({
    date, source: "pattern" as const, isRestDay: false, worksiteId: 5,
    segments: [{ shiftDefinitionId: 1, shiftCode: "+SUM(1,1)",
      startTime: "22:00", endTime: "06:00", breakMinutes: 0, spansMidnight: true }],
  })));
  malicious.employee.employeeNo = "=HYPERLINK(\"http://test\")";
  malicious.employee.name = "  @SUM(1,2)";
  const page = buildTeamRosterPageCsv([malicious], dates);
  assert.equal(page.split("\r\n").filter(Boolean).length, 8);
  assert.ok(page.includes("\"'=HYPERLINK(\"\"http://test\"\")\""));
  assert.ok(page.includes("\"'  @SUM(1,2)\""));
  assert.ok(page.includes("\"'+SUM(1,1) 22:00-06:00\""));
  assert.ok(page.includes("\"Yes\""));
  assert.ok(!page.includes("UNAUTHORIZED_PAGE_EMPLOYEE"));
  assert.throws(() => buildTeamRosterPageCsv([malicious], []));
});
