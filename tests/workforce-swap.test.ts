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
    worksiteId: 77,
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
    worksiteId: 77,
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

test("PostgreSQL jsonb key reordering does not falsely invalidate an unchanged swap", () => {
  const fresh = scheduleSwapSnapshot(schedule());
  function reorderJson(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(reorderJson);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
          .map(([key, field]) => [key, reorderJson(field)]),
      );
    }
    return value;
  }
  const stored = reorderJson(fresh) as typeof fresh;
  assert.notEqual(JSON.stringify(stored), JSON.stringify(fresh),
    "fixture must reproduce PostgreSQL jsonb key-order change");
  assert.equal(scheduleSwapSnapshotsMatch(stored, fresh), true);
  assert.equal(scheduleSwapSnapshotsMatch(fresh, stored), true);
});

test("swap snapshot rejects changed identities, shifts, missing/extra fields and reordered segments", () => {
  const base = scheduleSwapSnapshot(schedule());
  assert.equal(scheduleSwapSnapshotsMatch(base, { ...base, assignmentId: 999 }), false);
  assert.equal(scheduleSwapSnapshotsMatch(base, { ...base, worksiteId: null }), false);
  assert.equal(scheduleSwapSnapshotsMatch(base, {
    ...base, segments: [{ ...base.segments[0], startTime: "10:00" }],
  }), false);
  assert.equal(scheduleSwapSnapshotsMatch(base, {
    ...base, segments: [{ ...base.segments[0], breakMinutes: 45 }],
  }), false);
  assert.equal(scheduleSwapSnapshotsMatch(base, {
    ...base, segments: [...base.segments, { ...base.segments[0], shiftDefinitionId: 4 }],
  }), false);
  const missing = { ...base } as Record<string, unknown>;
  delete missing.patternId;
  assert.equal(scheduleSwapSnapshotsMatch(missing as typeof base, base), false);
  assert.equal(scheduleSwapSnapshotsMatch(base, { ...base, extra: "unexpected" } as typeof base), false);
  const multiple = {
    ...base, segments: [
      base.segments[0],
      { ...base.segments[0], shiftDefinitionId: 4, segmentOrder: 2 },
    ],
  };
  assert.equal(scheduleSwapSnapshotsMatch(multiple, {
    ...multiple, segments: [...multiple.segments].reverse(),
  }), false, "swapping the order of split-shift segments must remain blocked");
});

test("incoming schedule is converted into an approved day override without inventing hours", () => {
  const values = scheduleSwapOverrideValues(scheduleSwapSnapshot(schedule()), "Swap #18");
  assert.deepEqual(values, {
    kind: "shift",
    isRestDay: false,
    segments: [{ shiftDefinitionId: 3, segmentOrder: 1 }],
    workLocationOrgUnitId: 10,
    worksiteId: 77,
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
