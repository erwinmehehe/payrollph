import assert from "node:assert/strict";
import test from "node:test";
import {
  matchPunchesToWorkforceSegments,
  payrollRestDayFromSchedule,
  segmentPayableTime,
  workforceScheduleTrace,
} from "../src/lib/workforce-payroll";
import type { ResolvedDailySchedule } from "../src/lib/workforce-scheduling";

function schedule(input: Partial<ResolvedDailySchedule> = {}): ResolvedDailySchedule {
  return {
    date: "2026-10-04",
    source: "pattern",
    isRestDay: false,
    assignmentId: 11,
    patternId: 22,
    patternDayIndex: 3,
    overrideId: null,
    workLocationOrgUnitId: 77,
    worksiteId: 301,
    segments: [{
      shiftDefinitionId: 1,
      shiftCode: "DAY",
      shiftName: "Day",
      segmentOrder: 1,
      startTime: "08:00",
      endTime: "17:00",
      breakMinutes: 60,
      spansMidnight: false,
    }],
    audit: [],
    ...input,
  };
}

test("advanced workforce rest-day state overrides the legacy weekday flag", () => {
  assert.equal(payrollRestDayFromSchedule(schedule({ isRestDay: true }), false), true);
  assert.equal(payrollRestDayFromSchedule(schedule({ isRestDay: false }), true), false);
});

test("unassigned workforce dates preserve legacy rest-day behavior", () => {
  assert.equal(
    payrollRestDayFromSchedule(schedule({ source: "unassigned" }), true),
    true,
  );
  assert.equal(
    payrollRestDayFromSchedule(schedule({ source: "unassigned" }), false),
    false,
  );
});

test("one scheduled segment maps to one attendance punch", () => {
  const result = matchPunchesToWorkforceSegments({
    date: "2026-10-04",
    schedule: schedule(),
    punches: [{ id: 100, timeIn: "2026-10-04T08:01:00+08:00" }],
  });

  assert.equal(result.exception, null);
  assert.equal(result.segmentByPunchId.get(100)?.shiftCode, "DAY");
});

test("split-shift segments pair to punches in actual time-in order", () => {
  const split = schedule({
    segments: [
      {
        shiftDefinitionId: 3,
        shiftCode: "AM",
        shiftName: "AM",
        segmentOrder: 1,
        startTime: "09:00",
        endTime: "13:00",
        breakMinutes: 0,
        spansMidnight: false,
      },
      {
        shiftDefinitionId: 4,
        shiftCode: "PM",
        shiftName: "PM",
        segmentOrder: 2,
        startTime: "16:00",
        endTime: "20:00",
        breakMinutes: 0,
        spansMidnight: false,
      },
    ],
  });

  const result = matchPunchesToWorkforceSegments({
    date: "2026-10-04",
    schedule: split,
    punches: [
      { id: 202, timeIn: "2026-10-04T16:02:00+08:00" },
      { id: 201, timeIn: "2026-10-04T09:01:00+08:00" },
    ],
  });

  assert.equal(result.exception, null);
  assert.equal(result.segmentByPunchId.get(201)?.shiftCode, "AM");
  assert.equal(result.segmentByPunchId.get(202)?.shiftCode, "PM");
});

test("split-shift punch mismatch is an exception rather than a guessed mapping", () => {
  const split = schedule({
    segments: [
      {
        shiftDefinitionId: 3,
        shiftCode: "AM",
        shiftName: "AM",
        segmentOrder: 1,
        startTime: "09:00",
        endTime: "13:00",
        breakMinutes: 0,
        spansMidnight: false,
      },
      {
        shiftDefinitionId: 4,
        shiftCode: "PM",
        shiftName: "PM",
        segmentOrder: 2,
        startTime: "16:00",
        endTime: "20:00",
        breakMinutes: 0,
        spansMidnight: false,
      },
    ],
  });

  const result = matchPunchesToWorkforceSegments({
    date: "2026-10-04",
    schedule: split,
    punches: [{ id: 201, timeIn: "2026-10-04T09:01:00+08:00" }],
  });

  assert.equal(result.segmentByPunchId.size, 0);
  assert.match(result.exception ?? "", /2 segment\(s\).*1 punch record/i);
});

test("worked rest day keeps punch metadata for hours while rest-day status remains authoritative", () => {
  const result = matchPunchesToWorkforceSegments({
    date: "2026-10-04",
    schedule: schedule({ isRestDay: true, segments: [] }),
    punches: [{ id: 301, timeIn: "2026-10-04T10:00:00+08:00" }],
  });

  assert.equal(result.exception, null);
  assert.equal(result.segmentByPunchId.size, 0);
  assert.equal(payrollRestDayFromSchedule(schedule({ isRestDay: true, segments: [] }), false), true);
});

test("workforce trace persists assignment pattern override and shift identifiers", () => {
  const traced = workforceScheduleTrace({
    "2026-10-04": schedule({ overrideId: 55, source: "override" }),
  });

  assert.deepEqual(traced[0], {
    date: "2026-10-04",
    source: "override",
    isRestDay: false,
    assignmentId: 11,
    patternId: 22,
    patternDayIndex: 3,
    overrideId: 55,
    workLocationOrgUnitId: 77,
    worksiteId: 301,
    segments: [{
      shiftDefinitionId: 1,
      shiftCode: "DAY",
      segmentOrder: 1,
      startTime: "08:00",
      endTime: "17:00",
      breakMinutes: 60,
      spansMidnight: false,
    }],
  });
});


test("overnight payable time splits at midnight, night differential, and overtime boundaries", () => {
  const result = segmentPayableTime({
    punch: {
      id: 401,
      workDate: "2026-10-04",
      timeIn: "2026-10-04T18:00:00+08:00",
      timeOut: "2026-10-05T03:00:00+08:00",
    },
    shift: {
      start: "18:00",
      end: "02:00",
      breakMinutes: 0,
      spansMidnight: true,
    },
  });

  assert.equal(result.allocationComplete, true);
  assert.deepEqual(result.attendanceCalendarDates, ["2026-10-04", "2026-10-05"]);
  assert.deepEqual(
    result.segments.map((segment) => ({
      date: segment.calendarDate,
      minutes: segment.minutes,
      overtime: segment.overtime,
      night: segment.night,
    })),
    [
      { date: "2026-10-04", minutes: 240, overtime: false, night: false },
      { date: "2026-10-04", minutes: 120, overtime: false, night: true },
      { date: "2026-10-05", minutes: 120, overtime: false, night: true },
      { date: "2026-10-05", minutes: 60, overtime: true, night: true },
    ],
  );
});

test("payable time stops night differential at 06:00", () => {
  const result = segmentPayableTime({
    punch: {
      id: 402,
      workDate: "2026-10-05",
      timeIn: "2026-10-05T05:00:00+08:00",
      timeOut: "2026-10-05T07:00:00+08:00",
    },
    shift: {
      start: "05:00",
      end: "07:00",
      breakMinutes: 0,
    },
  });

  assert.deepEqual(
    result.segments.map((segment) => ({
      minutes: segment.minutes,
      night: segment.night,
    })),
    [
      { minutes: 60, night: true },
      { minutes: 60, night: false },
    ],
  );
});

test("explicit break is removed before premium buckets are priced", () => {
  const result = segmentPayableTime({
    punch: {
      id: 403,
      workDate: "2026-10-04",
      timeIn: "2026-10-04T21:00:00+08:00",
      timeOut: "2026-10-05T07:00:00+08:00",
      breakStart: "2026-10-05T01:00:00+08:00",
      breakEnd: "2026-10-05T02:00:00+08:00",
    },
    shift: {
      start: "21:00",
      end: "07:00",
      breakMinutes: 60,
      spansMidnight: true,
    },
  });

  assert.equal(result.allocationComplete, true);
  assert.equal(
    result.segments.reduce((minutes, segment) => minutes + segment.minutes, 0),
    540,
  );
  assert.equal(
    result.segments
      .filter((segment) => segment.night)
      .reduce((minutes, segment) => minutes + segment.minutes, 0),
    420,
  );
});

test("unlocated scheduled break fails closed instead of guessing a premium bucket", () => {
  const result = segmentPayableTime({
    punch: {
      id: 404,
      workDate: "2026-10-04",
      timeIn: "2026-10-04T21:00:00+08:00",
      timeOut: "2026-10-05T07:00:00+08:00",
    },
    shift: {
      start: "21:00",
      end: "07:00",
      breakMinutes: 60,
      spansMidnight: true,
    },
  });

  assert.equal(result.allocationComplete, false);
  assert.match(result.flags.join(" "), /break has no actual location/i);
  assert.deepEqual(result.attendanceCalendarDates, ["2026-10-04", "2026-10-05"]);
});
