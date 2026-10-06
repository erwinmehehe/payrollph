import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

type IntervalModule = {
  validateLeaveIntervals?: (input: unknown[]) => { ok: boolean; errors: string[] };
  resolveLeaveIntervalsForSchedule?: (input: any) => {
    unavailableWallMinutes: number;
    unavailablePaidMinutes: number | null;
    partiallyAvailable: boolean;
    blockers: Array<{ code: string; message: string }>;
    warnings: Array<{ code: string; message: string }>;
    segmentImpacts: Array<{ segmentOrder: number; unavailableWallMinutes: number; unavailablePaidMinutes: number | null }>;
  };
};

async function loadModule(): Promise<IntervalModule | null> {
  try {
    const modulePath = "../src/lib/workforce-absence-" + "intervals";
    return await import(modulePath) as IntervalModule;
  } catch {
    return null;
  }
}

const singleShift = {
  date: "2026-10-06",
  source: "pattern",
  isRestDay: false,
  assignmentId: 1,
  patternId: 1,
  patternDayIndex: 1,
  overrideId: null,
  workLocationOrgUnitId: 1,
  worksiteId: 10,
  audit: [],
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
};

test("precise leave interval resolver exists", async () => {
  const mod = await loadModule();
  assert.ok(mod?.validateLeaveIntervals);
  assert.ok(mod?.resolveLeaveIntervalsForSchedule);
});

test("first half resolves from scheduled paid minutes, not a fixed clock assumption", async () => {
  const mod = await loadModule();
  assert.ok(mod?.resolveLeaveIntervalsForSchedule);
  const result = mod.resolveLeaveIntervalsForSchedule!({
    workDate: "2026-10-06",
    intervals: [{ kind: "first_half", workDate: "2026-10-06", timezone: "Asia/Manila" }],
    schedule: singleShift,
  });
  assert.equal(result.unavailablePaidMinutes, 240);
  assert.equal(result.partiallyAvailable, true);
});

test("split shift half-day partitions scheduled paid minutes in segment order", async () => {
  const mod = await loadModule();
  assert.ok(mod?.resolveLeaveIntervalsForSchedule);
  const result = mod.resolveLeaveIntervalsForSchedule!({
    workDate: "2026-10-06",
    intervals: [{ kind: "second_half", workDate: "2026-10-06", timezone: "Asia/Manila" }],
    schedule: {
      ...singleShift,
      segments: [
        { ...singleShift.segments[0], shiftDefinitionId: 1, shiftCode: "AM", segmentOrder: 1, startTime: "08:00", endTime: "12:00", breakMinutes: 0 },
        { ...singleShift.segments[0], shiftDefinitionId: 2, shiftCode: "PM", segmentOrder: 2, startTime: "13:00", endTime: "17:00", breakMinutes: 0 },
      ],
    },
  });
  assert.equal(result.unavailablePaidMinutes, 240);
  assert.equal(result.segmentImpacts[0]?.unavailablePaidMinutes, 0);
  assert.equal(result.segmentImpacts[1]?.unavailablePaidMinutes, 240);
});

test("timed leave crossing midnight overlaps an overnight shift", async () => {
  const mod = await loadModule();
  assert.ok(mod?.resolveLeaveIntervalsForSchedule);
  const result = mod.resolveLeaveIntervalsForSchedule!({
    workDate: "2026-10-06",
    intervals: [{
      kind: "timed",
      workDate: "2026-10-06",
      startLocalTime: "23:00",
      endLocalTime: "01:00",
      endsNextDay: true,
      timezone: "Asia/Manila",
    }],
    schedule: {
      ...singleShift,
      segments: [{
        ...singleShift.segments[0],
        shiftCode: "NIGHT",
        startTime: "22:00",
        endTime: "06:00",
        breakMinutes: 0,
        spansMidnight: true,
      }],
    },
  });
  assert.equal(result.unavailableWallMinutes, 120);
  assert.equal(result.unavailablePaidMinutes, 120);
});

test("timed leave with unknown break placement does not claim exact paid minutes", async () => {
  const mod = await loadModule();
  assert.ok(mod?.resolveLeaveIntervalsForSchedule);
  const result = mod.resolveLeaveIntervalsForSchedule!({
    workDate: "2026-10-06",
    intervals: [{
      kind: "timed",
      workDate: "2026-10-06",
      startLocalTime: "12:00",
      endLocalTime: "14:00",
      endsNextDay: false,
      timezone: "Asia/Manila",
    }],
    schedule: singleShift,
  });
  assert.equal(result.unavailableWallMinutes, 120);
  assert.equal(result.unavailablePaidMinutes, null);
  assert.ok(result.warnings.some((item) => item.code === "BREAK_PLACEMENT_UNKNOWN"));
});

test("half-day without a schedule returns an evidence blocker", async () => {
  const mod = await loadModule();
  assert.ok(mod?.resolveLeaveIntervalsForSchedule);
  const result = mod.resolveLeaveIntervalsForSchedule!({
    workDate: "2026-10-06",
    intervals: [{ kind: "first_half", workDate: "2026-10-06", timezone: "Asia/Manila" }],
    schedule: { ...singleShift, segments: [] },
  });
  assert.ok(result.blockers.some((item) => item.code === "SCHEDULE_REQUIRED"));
});

test("schema declares immutable leave interval revisions and current-set uniqueness", () => {
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const baseline = readFileSync("drizzle/baseline.sql", "utf8");
  assert.ok(schema.includes("leaveRequestIntervalSets"));
  assert.ok(schema.includes("leaveRequestIntervals"));
  assert.ok(baseline.includes("leave_request_interval_sets"));
  assert.ok(baseline.includes("leave_request_intervals"));
  assert.ok(baseline.includes("leave_interval_set_current_unique"));
});
