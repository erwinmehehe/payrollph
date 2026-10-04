import assert from "node:assert/strict";
import test from "node:test";
import {
  assertScheduleSwappable,
  scheduleSwapOverrideValues,
  scheduleSwapSnapshot,
  scheduleSwapSnapshotsMatch,
} from "../src/lib/workforce-swap";
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

test("swap snapshot preserves payroll-relevant resolved schedule identity", () => {
  const snapshot = scheduleSwapSnapshot(schedule());
  assert.deepEqual(snapshot, {
    date: "2026-10-05",
    source: "pattern",
    isRestDay: false,
    assignmentId: 1,
    patternId: 2,
    patternDayIndex: 0,
    overrideId: null,
    workLocationOrgUnitId: 10,
    segments: [{
      shiftDefinitionId: 3,
      shiftCode: "DAY",
      segmentOrder: 1,
      startTime: "09:00",
      endTime: "18:00",
      breakMinutes: 60,
      spansMidnight: false,
    }],
  });
});

test("unassigned and already-overridden days fail closed", () => {
  assert.throws(
    () => assertScheduleSwappable(scheduleSwapSnapshot(schedule({ source: "unassigned", segments: [] }))),
    /unassigned workforce day/,
  );
  assert.throws(
    () => assertScheduleSwappable(scheduleSwapSnapshot(schedule({ source: "override", overrideId: 9 }))),
    /cannot stack on an existing day-level override/,
  );
});

test("snapshot comparison detects schedule changes after request", () => {
  const expected = scheduleSwapSnapshot(schedule());
  const changed = scheduleSwapSnapshot(schedule({
    segments: [{
      shiftDefinitionId: 4,
      shiftCode: "NIGHT",
      shiftName: "Night",
      segmentOrder: 1,
      startTime: "22:00",
      endTime: "06:00",
      breakMinutes: 60,
      spansMidnight: true,
    }],
  }));
  assert.equal(scheduleSwapSnapshotsMatch(expected, expected), true);
  assert.equal(scheduleSwapSnapshotsMatch(expected, changed), false);
});

test("incoming schedule is converted into an approved day override without inventing hours", () => {
  const values = scheduleSwapOverrideValues(scheduleSwapSnapshot(schedule()), "Swap #18");
  assert.deepEqual(values, {
    kind: "shift",
    isRestDay: false,
    segments: [{ shiftDefinitionId: 3, segmentOrder: 1 }],
    workLocationOrgUnitId: 10,
    reason: "Swap #18",
  });
});

test("rest-day swap transfers the rest-day state explicitly", () => {
  const values = scheduleSwapOverrideValues(
    scheduleSwapSnapshot(schedule({ isRestDay: true, segments: [] })),
    "Swap #19",
  );
  assert.equal(values.kind, "rest_day");
  assert.equal(values.isRestDay, true);
  assert.deepEqual(values.segments, []);
});
