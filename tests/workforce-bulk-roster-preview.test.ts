import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { rosterWeekDates, type TeamRosterRow } from "../src/lib/workforce-team-roster";
import {
  bulkRosterPreviewCsv, previewBulkRosterDay,
} from "../src/lib/workforce-bulk-roster-preview";

const dates = rosterWeekDates("2026-10-12");
const shift = { id: 9, code: "MID", name: "Mid", startTime: "10:00", endTime: "18:00", spansMidnight: false };
const daySegment = {
  shiftDefinitionId: 2, shiftCode: "DAY", startTime: "09:00", endTime: "17:00",
  breakMinutes: 60, spansMidnight: false,
};
function worker(employeeId = 1): TeamRosterRow {
  return {
    employee: { id: employeeId, employeeNo: "E" + employeeId, name: "Fictional " + employeeId, status: "Active", orgUnitId: 1 },
    error: null,
    days: dates.map(date => ({
      date, source: "pattern", isRestDay: false, worksiteId: 44, segments: [{ ...daySegment }],
    })),
  };
}
function request(rows: TeamRosterRow[] = [worker()], date = dates[2]) {
  return {
    weekDates: dates, rows, selectedEmployeeIds: rows.map(r => r.employee.id),
    workDate: date, today: "2026-10-10", shift,
  };
}

test("batch preview only uses explicit page selection, never writes shifts", () => {
  const result = previewBulkRosterDay(request([worker(1), worker(2)]));
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(x => x.status), ["review", "review"]);
  assert.ok(result.every(row => row.reasons.some(s => s.includes("live source"))));
  assert.equal(result[0].employeeId, 1);
  assert.throws(() => previewBulkRosterDay({
    ...request(), selectedEmployeeIds: [999],
  }), /authorized current roster page/);
  assert.throws(() => previewBulkRosterDay({
    ...request(), selectedEmployeeIds: [1, 1],
  }), /20 distinct workers/);
});

test("only future dates in a complete exact roster week can be proposed", () => {
  assert.throws(() => previewBulkRosterDay({ ...request(), workDate: "2026-10-10" }), /future date/);
  assert.throws(() => previewBulkRosterDay({ ...request(), workDate: "2026-10-19" }), /future date/);
  assert.throws(() => previewBulkRosterDay({ ...request(), weekDates: [...dates.slice(0, 6), dates[5]] }), /consecutive/);
  assert.throws(() => previewBulkRosterDay({ ...request(), shift: { ...shift, endTime: "08:00" } }), /duration/);
  assert.throws(() => previewBulkRosterDay({ ...request(), shift: { ...shift, startTime: "25:00" } }), /clock/);
});

test("approved overrides, split shifts and nonactive workers cannot bypass individual controls", () => {
  const overridden = worker(1);
  overridden.days[2].source = "override";
  const split = worker(2);
  split.days[2].segments.push({ ...daySegment, shiftDefinitionId: 3 });
  const inactive = worker(3);
  inactive.employee.status = "Separated";
  const result = previewBulkRosterDay(request([overridden, split, inactive]));
  assert.deepEqual(result.map(x => x.status), ["blocked", "blocked", "blocked"]);
});

test("unchanged shift is not proposed again and recorded rest day requires review", () => {
  const original = worker(1);
  const rest = worker(2);
  rest.days[2].isRestDay = true;
  rest.days[2].segments = [];
  const outcome = previewBulkRosterDay({
    ...request([original, rest]), shift: { ...shift, id: 2 },
  });
  assert.equal(outcome[0].status, "unchanged");
  assert.equal(outcome[1].status, "review");
  assert.ok(outcome[1].reasons.some(s => s.includes("rest-day")));
});

test("overnight work from a previous day blocks a conflicting proposed early shift", () => {
  const row = worker();
  row.days[1].segments = [{
    shiftDefinitionId: 4, shiftCode: "NIGHT", startTime: "21:00", endTime: "08:00",
    breakMinutes: 60, spansMidnight: true,
  }];
  const preview = previewBulkRosterDay({
    ...request([row]), shift: { ...shift, startTime: "06:00", endTime: "14:00" },
  });
  assert.equal(preview[0].status, "blocked");
  assert.match(preview[0].reasons.join(" "), /overlaps another recorded shift/);
});

test("boundary dates are never cleared without out-of-week evidence", () => {
  const preview = previewBulkRosterDay(request([worker()], dates[0]));
  assert.equal(preview[0].status, "review");
  assert.match(preview[0].reasons.join(" "), /Adjacent-week/);
});

test("CSV export is page-limited and neutralizes formula injection in employee names", () => {
  const row = worker();
  row.employee.name = '=HYPERLINK("malicious")';
  row.employee.employeeNo = "+12345";
  const preview = previewBulkRosterDay(request([row]));
  const csv = bulkRosterPreviewCsv(preview);
  assert.match(csv, /"'\+12345"/);
  assert.match(csv, /"'=HYPERLINK/);
  assert.ok(!csv.includes("bank"));
});

test("draft UI uses only a role-scoped roster GET, not bulk mutations", () => {
  const ui = readFileSync("src/components/workspace/workforce-bulk-roster-preview.tsx", "utf8");
  const planner = readFileSync("src/components/workspace/workforce-planner.tsx", "utf8");
  assert.ok(ui.includes('fetch("/api/workforce/team-roster?"'));
  assert.ok(!ui.includes('method: "POST"'));
  assert.ok(!ui.includes("api/payroll"));
  assert.ok(ui.includes("pending.current?.abort()"));
  assert.ok(ui.includes("snapshot?.scope === scope"));
  assert.ok(planner.includes('id="wfm-panel-bulk"'));
  assert.ok(planner.includes('"owner", "admin", "bookkeeper", "hr"'));
});
