import assert from "node:assert/strict";
import test from "node:test";
import {
  matchPunchesToWorkforceSegments,
  segmentPayableTime,
  workforceScheduleTrace,
} from "../src/lib/workforce-payroll";
import {
  resolveDailySchedule,
  type ResolvedDailySchedule,
} from "../src/lib/workforce-scheduling";
import {
  scheduleSwapOverrideValues,
  scheduleSwapSnapshot,
} from "../src/lib/workforce-swap";

function splitSchedule(): ResolvedDailySchedule {
  return {
    date: "2026-10-05",
    source: "override",
    isRestDay: false,
    assignmentId: 10,
    patternId: 20,
    patternDayIndex: 0,
    overrideId: 30,
    workLocationOrgUnitId: 40,
    worksiteId: 50,
    segments: [
      {
        shiftDefinitionId: 1,
        shiftCode: "AM",
        shiftName: "Morning",
        segmentOrder: 1,
        startTime: "08:00",
        endTime: "12:00",
        breakMinutes: 0,
        spansMidnight: false,
      },
      {
        shiftDefinitionId: 2,
        shiftCode: "PM",
        shiftName: "Afternoon",
        segmentOrder: 2,
        startTime: "14:00",
        endTime: "18:00",
        breakMinutes: 0,
        spansMidnight: false,
      },
    ],
    audit: ["Approved split-shift override"],
  };
}

test("split-shift punches map deterministically into payroll schedule segments and trace", () => {
  const schedule = splitSchedule();
  const matched = matchPunchesToWorkforceSegments({
    date: schedule.date,
    schedule,
    punches: [
      { id: 102, timeIn: "2026-10-05T06:00:00.000Z" },
      { id: 101, timeIn: "2026-10-05T00:00:00.000Z" },
    ],
  });

  assert.equal(matched.exception, null);
  assert.equal(matched.segmentByPunchId.get(101)?.shiftCode, "AM");
  assert.equal(matched.segmentByPunchId.get(102)?.shiftCode, "PM");

  const [trace] = workforceScheduleTrace({ [schedule.date]: schedule });
  assert.equal(trace.source, "override");
  assert.equal(trace.overrideId, 30);
  assert.equal(trace.worksiteId, 50);
  assert.deepEqual(trace.segments.map((segment) => segment.shiftCode), ["AM", "PM"]);
});

test("split-shift punch mismatch fails visibly instead of guessing payroll pricing", () => {
  const schedule = splitSchedule();
  const matched = matchPunchesToWorkforceSegments({
    date: schedule.date,
    schedule,
    punches: [{ id: 101, timeIn: "2026-10-05T00:00:00.000Z" }],
  });
  assert.match(matched.exception ?? "", /verify split\/shift attendance before release/i);
  assert.equal(matched.segmentByPunchId.size, 0);
});

test("overnight payable-time evidence crosses calendar days without losing night allocation", () => {
  const result = segmentPayableTime({
    punch: {
      id: 77,
      workDate: "2026-10-05",
      timeIn: "2026-10-05T14:00:00.000Z",
      timeOut: "2026-10-05T22:00:00.000Z",
      breakStart: "2026-10-05T18:00:00.000Z",
      breakEnd: "2026-10-05T19:00:00.000Z",
    },
    shift: {
      start: "22:00",
      end: "06:00",
      breakMinutes: 60,
      spansMidnight: true,
    },
  });

  assert.equal(result.allocationComplete, true);
  assert.deepEqual(result.flags, []);
  assert.deepEqual(result.attendanceCalendarDates, ["2026-10-05", "2026-10-06"]);
  assert.equal(result.segments.reduce((sum, segment) => sum + segment.minutes, 0), 420);
  assert.equal(result.segments.every((segment) => segment.night), true);
  assert.equal(result.segments.some((segment) => segment.overtime), false);
});

test("approved schedule-swap override preserves split schedule identity for payroll trace", () => {
  const incoming = scheduleSwapSnapshot(splitSchedule());
  const values = scheduleSwapOverrideValues(incoming, "Approved swap #55");
  assert.equal(values.kind, "split_shift");

  const resolved = resolveDailySchedule({
    date: "2026-10-06",
    assignments: [{
      id: 10,
      patternId: 1,
      effectiveFrom: "2026-10-01",
      effectiveUntil: null,
      anchorDate: "2026-10-01",
      workLocationOrgUnitId: 40,
      worksiteId: 60,
    }],
    patterns: [{ id: 1, code: "BASE", name: "Base", cycleDays: 1 }],
    patternDays: [{ id: 1, patternId: 1, dayIndex: 0, isRestDay: false }],
    patternSegments: [{ patternDayId: 1, shiftDefinitionId: 3, segmentOrder: 1 }],
    shifts: [
      { id: 1, code: "AM", name: "Morning", startTime: "08:00", endTime: "12:00", breakMinutes: 0, spansMidnight: false },
      { id: 2, code: "PM", name: "Afternoon", startTime: "14:00", endTime: "18:00", breakMinutes: 0, spansMidnight: false },
      { id: 3, code: "BASE", name: "Base", startTime: "09:00", endTime: "18:00", breakMinutes: 60, spansMidnight: false },
    ],
    overrides: [{
      id: 99,
      workDate: "2026-10-06",
      ...values,
      status: "approved",
    }],
  });

  assert.equal(resolved.source, "override");
  assert.equal(resolved.overrideId, 99);
  assert.equal(resolved.worksiteId, 50);
  assert.deepEqual(resolved.segments.map((segment) => segment.shiftCode), ["AM", "PM"]);

  const [trace] = workforceScheduleTrace({ [resolved.date]: resolved });
  assert.equal(trace.source, "override");
  assert.deepEqual(trace.segments.map((segment) => segment.shiftDefinitionId), [1, 2]);
});
