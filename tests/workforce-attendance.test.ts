import assert from "node:assert/strict";
import test from "node:test";
import { analyzeAttendanceDay } from "../src/lib/workforce-attendance";
import type { ResolvedDailySchedule } from "../src/lib/workforce-scheduling";

function schedule(overrides: Partial<ResolvedDailySchedule> = {}): ResolvedDailySchedule {
  return {
    date: "2026-10-05",
    source: "pattern",
    isRestDay: false,
    assignmentId: 1,
    patternId: 2,
    patternDayIndex: 0,
    overrideId: null,
    workLocationOrgUnitId: 10,
    worksiteId: null,
    segments: [{
      shiftDefinitionId: 3,
      shiftCode: "DAY",
      shiftName: "Day",
      segmentOrder: 1,
      startTime: "09:00",
      endTime: "18:00",
      breakMinutes: 60,
      spansMidnight: false,
    }],
    audit: [],
    ...overrides,
  };
}

test("scheduled working day with no punch is a blocking exception", () => {
  const result = analyzeAttendanceDay({
    date: "2026-10-05",
    schedule: schedule(),
    punches: [],
  });
  assert.equal(result.reviewRequired, true);
  assert.ok(result.exceptions.some((row) => row.kind === "missing_punch"));
});

test("late arrival, undertime and early clock-in are derived from the resolved shift", () => {
  const late = analyzeAttendanceDay({
    date: "2026-10-05",
    schedule: schedule(),
    punches: [{
      id: 1,
      timeIn: "2026-10-05T09:20:00+08:00",
      timeOut: "2026-10-05T17:30:00+08:00",
    }],
  });
  assert.ok(late.exceptions.some((row) => row.kind === "late_arrival"));
  assert.ok(late.exceptions.some((row) => row.kind === "early_departure"));

  const early = analyzeAttendanceDay({
    date: "2026-10-05",
    schedule: schedule(),
    punches: [{
      id: 2,
      timeIn: "2026-10-05T08:30:00+08:00",
      timeOut: "2026-10-05T18:00:00+08:00",
    }],
  });
  assert.ok(early.exceptions.some((row) => row.kind === "early_clock_in"));
});

test("approved overtime remains visible without creating an authorization blocker", () => {
  const result = analyzeAttendanceDay({
    date: "2026-10-05",
    schedule: schedule(),
    punches: [{
      id: 3,
      timeIn: "2026-10-05T09:00:00+08:00",
      timeOut: "2026-10-05T19:00:00+08:00",
    }],
    overtimeRequests: [{
      id: 10,
      status: "approved",
      requestKind: "pre_approved",
      requestedMinutes: 60,
      requestedByUserId: 7,
      decidedByUserId: 8,
    }],
  });
  assert.equal(result.overtimeMinutes, 60);
  assert.equal(result.overtimeAuthorization.reviewRequired, false);
  assert.ok(result.exceptions.some((row) => row.kind === "late_clock_out"));
  assert.ok(!result.exceptions.some((row) => row.kind === "overtime_authorization"));
});

test("worked overtime without approval is a blocking review exception but preserves actual minutes", () => {
  const result = analyzeAttendanceDay({
    date: "2026-10-05",
    schedule: schedule(),
    punches: [{
      id: 4,
      timeIn: "2026-10-05T09:00:00+08:00",
      timeOut: "2026-10-05T19:00:00+08:00",
    }],
    overtimeRequests: [],
  });
  assert.equal(result.overtimeMinutes, 60);
  assert.equal(result.reviewRequired, true);
  assert.equal(result.overtimeAuthorization.payrollEntitlementIndependent, true);
  assert.ok(result.exceptions.some((row) => row.kind === "overtime_authorization"));
});

test("split-shift punch count mismatch fails closed instead of guessing", () => {
  const split = schedule({
    segments: [
      { shiftDefinitionId: 3, shiftCode: "AM", shiftName: "AM", segmentOrder: 1, startTime: "09:00", endTime: "13:00", breakMinutes: 0, spansMidnight: false },
      { shiftDefinitionId: 4, shiftCode: "PM", shiftName: "PM", segmentOrder: 2, startTime: "16:00", endTime: "20:00", breakMinutes: 0, spansMidnight: false },
    ],
  });
  const result = analyzeAttendanceDay({
    date: "2026-10-05",
    schedule: split,
    punches: [{ id: 5, timeIn: "2026-10-05T09:00:00+08:00", timeOut: "2026-10-05T13:00:00+08:00" }],
  });
  assert.equal(result.reviewRequired, true);
  assert.ok(result.exceptions.some((row) => row.kind === "schedule_punch_mismatch"));
});

test("duplicate punch pairs are detected explicitly", () => {
  const result = analyzeAttendanceDay({
    date: "2026-10-05",
    schedule: schedule({ source: "unassigned", segments: [] }),
    punches: [
      { id: 6, timeIn: "2026-10-05T09:00:00+08:00", timeOut: "2026-10-05T18:00:00+08:00" },
      { id: 7, timeIn: "2026-10-05T09:00:00+08:00", timeOut: "2026-10-05T18:00:00+08:00" },
    ],
  });
  assert.ok(result.exceptions.filter((row) => row.kind === "duplicate_punch").length >= 2);
});
