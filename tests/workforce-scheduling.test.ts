import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveDailySchedule,
  shiftCrossesMidnight,
  validateSchedulePattern,
  type WorkforceScheduleAssignment,
  type WorkforceSchedulePattern,
  type WorkforceSchedulePatternDay,
  type WorkforceSchedulePatternSegment,
  type WorkforceShiftDefinition,
} from "../src/lib/workforce-scheduling";

const shifts: WorkforceShiftDefinition[] = [
  {
    id: 1,
    code: "DAY",
    name: "Day Shift",
    startTime: "08:00",
    endTime: "17:00",
    breakMinutes: 60,
  },
  {
    id: 2,
    code: "NIGHT",
    name: "Night Shift",
    startTime: "22:00",
    endTime: "06:00",
    breakMinutes: 60,
  },
  {
    id: 3,
    code: "SPLIT-AM",
    name: "Split AM",
    startTime: "09:00",
    endTime: "13:00",
    breakMinutes: 0,
  },
  {
    id: 4,
    code: "SPLIT-PM",
    name: "Split PM",
    startTime: "16:00",
    endTime: "20:00",
    breakMinutes: 0,
  },
];

function fourOnTwoOffFixture() {
  const pattern: WorkforceSchedulePattern = {
    id: 10,
    code: "4ON2OFF",
    name: "Four on, two off",
    cycleDays: 6,
  };
  const days: WorkforceSchedulePatternDay[] = Array.from({ length: 6 }, (_, dayIndex) => ({
    id: 100 + dayIndex,
    patternId: pattern.id,
    dayIndex,
    isRestDay: dayIndex >= 4,
    label: dayIndex >= 4 ? "Rest" : "Work",
  }));
  const segments: WorkforceSchedulePatternSegment[] = days
    .filter((day) => !day.isRestDay)
    .map((day) => ({
      patternDayId: day.id,
      shiftDefinitionId: 1,
      segmentOrder: 1,
    }));
  const assignments: WorkforceScheduleAssignment[] = [{
    id: 500,
    patternId: pattern.id,
    effectiveFrom: "2026-10-01",
    effectiveUntil: null,
    anchorDate: "2026-10-01",
    workLocationOrgUnitId: 77,
  }];
  return { pattern, days, segments, assignments };
}

test("4-on/2-off rotation repeats from its explicit anchor date", () => {
  const fixture = fourOnTwoOffFixture();

  for (const [date, isRestDay, dayIndex] of [
    ["2026-10-01", false, 0],
    ["2026-10-04", false, 3],
    ["2026-10-05", true, 4],
    ["2026-10-06", true, 5],
    ["2026-10-07", false, 0],
  ] as const) {
    const resolved = resolveDailySchedule({
      date,
      assignments: fixture.assignments,
      patterns: [fixture.pattern],
      patternDays: fixture.days,
      patternSegments: fixture.segments,
      shifts,
    });

    assert.equal(resolved.source, "pattern");
    assert.equal(resolved.patternDayIndex, dayIndex);
    assert.equal(resolved.isRestDay, isRestDay);
    assert.equal(resolved.workLocationOrgUnitId, 77);
    assert.equal(resolved.segments.length, isRestDay ? 0 : 1);
  }
});

test("night shifts crossing midnight are explicit in the resolved schedule", () => {
  const pattern: WorkforceSchedulePattern = {
    id: 20,
    code: "NIGHT",
    name: "Night",
    cycleDays: 1,
  };
  const days: WorkforceSchedulePatternDay[] = [{
    id: 200,
    patternId: 20,
    dayIndex: 0,
    isRestDay: false,
  }];
  const segments: WorkforceSchedulePatternSegment[] = [{
    patternDayId: 200,
    shiftDefinitionId: 2,
    segmentOrder: 1,
  }];

  const resolved = resolveDailySchedule({
    date: "2026-10-04",
    assignments: [{
      id: 501,
      patternId: 20,
      effectiveFrom: "2026-10-01",
      anchorDate: "2026-10-01",
    }],
    patterns: [pattern],
    patternDays: days,
    patternSegments: segments,
    shifts,
  });

  assert.equal(shiftCrossesMidnight(shifts[1]), true);
  assert.equal(resolved.segments[0].spansMidnight, true);
  assert.equal(resolved.segments[0].startTime, "22:00");
  assert.equal(resolved.segments[0].endTime, "06:00");
});

test("split shifts preserve multiple ordered segments on the same work date", () => {
  const pattern: WorkforceSchedulePattern = {
    id: 30,
    code: "SPLIT",
    name: "Split shift",
    cycleDays: 1,
  };
  const days: WorkforceSchedulePatternDay[] = [{
    id: 300,
    patternId: 30,
    dayIndex: 0,
    isRestDay: false,
  }];
  const segments: WorkforceSchedulePatternSegment[] = [
    { patternDayId: 300, shiftDefinitionId: 4, segmentOrder: 2 },
    { patternDayId: 300, shiftDefinitionId: 3, segmentOrder: 1 },
  ];

  const resolved = resolveDailySchedule({
    date: "2026-10-04",
    assignments: [{
      id: 502,
      patternId: 30,
      effectiveFrom: "2026-10-01",
      anchorDate: "2026-10-01",
    }],
    patterns: [pattern],
    patternDays: days,
    patternSegments: segments,
    shifts,
  });

  assert.deepEqual(
    resolved.segments.map((segment) => segment.shiftCode),
    ["SPLIT-AM", "SPLIT-PM"],
  );
});

test("approved rest-day override wins over the normal rotation", () => {
  const fixture = fourOnTwoOffFixture();

  const resolved = resolveDailySchedule({
    date: "2026-10-02",
    assignments: fixture.assignments,
    patterns: [fixture.pattern],
    patternDays: fixture.days,
    patternSegments: fixture.segments,
    shifts,
    overrides: [{
      id: 900,
      workDate: "2026-10-02",
      kind: "rest_day",
      isRestDay: true,
      status: "approved",
      reason: "Approved substitute rest day",
    }],
  });

  assert.equal(resolved.source, "override");
  assert.equal(resolved.overrideId, 900);
  assert.equal(resolved.isRestDay, true);
  assert.equal(resolved.segments.length, 0);
});

test("location-only override preserves the underlying shift while changing work location", () => {
  const fixture = fourOnTwoOffFixture();

  const resolved = resolveDailySchedule({
    date: "2026-10-02",
    assignments: fixture.assignments,
    patterns: [fixture.pattern],
    patternDays: fixture.days,
    patternSegments: fixture.segments,
    shifts,
    overrides: [{
      id: 901,
      workDate: "2026-10-02",
      kind: "location",
      isRestDay: false,
      workLocationOrgUnitId: 88,
      status: "approved",
      reason: "Temporary site coverage",
    }],
  });

  assert.equal(resolved.source, "override");
  assert.equal(resolved.workLocationOrgUnitId, 88);
  assert.equal(resolved.segments.length, 1);
  assert.equal(resolved.segments[0].shiftCode, "DAY");
});

test("later effective assignment replaces the older open-ended assignment without rewriting history", () => {
  const dayPattern: WorkforceSchedulePattern = {
    id: 40,
    code: "DAY",
    name: "Day",
    cycleDays: 1,
  };
  const nightPattern: WorkforceSchedulePattern = {
    id: 41,
    code: "NIGHT",
    name: "Night",
    cycleDays: 1,
  };
  const days: WorkforceSchedulePatternDay[] = [
    { id: 400, patternId: 40, dayIndex: 0, isRestDay: false },
    { id: 410, patternId: 41, dayIndex: 0, isRestDay: false },
  ];
  const segments: WorkforceSchedulePatternSegment[] = [
    { patternDayId: 400, shiftDefinitionId: 1, segmentOrder: 1 },
    { patternDayId: 410, shiftDefinitionId: 2, segmentOrder: 1 },
  ];
  const assignments: WorkforceScheduleAssignment[] = [
    {
      id: 700,
      patternId: 40,
      effectiveFrom: "2026-09-01",
      anchorDate: "2026-09-01",
    },
    {
      id: 701,
      patternId: 41,
      effectiveFrom: "2026-10-15",
      anchorDate: "2026-10-15",
    },
  ];

  const before = resolveDailySchedule({
    date: "2026-10-14",
    assignments,
    patterns: [dayPattern, nightPattern],
    patternDays: days,
    patternSegments: segments,
    shifts,
  });
  const after = resolveDailySchedule({
    date: "2026-10-15",
    assignments,
    patterns: [dayPattern, nightPattern],
    patternDays: days,
    patternSegments: segments,
    shifts,
  });

  assert.equal(before.assignmentId, 700);
  assert.equal(before.segments[0].shiftCode, "DAY");
  assert.equal(after.assignmentId, 701);
  assert.equal(after.segments[0].shiftCode, "NIGHT");
});

test("unassigned dates fail open to review, never inventing a schedule", () => {
  const resolved = resolveDailySchedule({
    date: "2026-10-04",
    assignments: [],
    patterns: [],
    patternDays: [],
    patternSegments: [],
    shifts,
  });

  assert.equal(resolved.source, "unassigned");
  assert.equal(resolved.isRestDay, false);
  assert.equal(resolved.segments.length, 0);
  assert.match(resolved.audit[0], /not guessed/i);
});

test("pattern validation rejects gaps because payroll must not infer missing rotation days", () => {
  assert.throws(() => validateSchedulePattern({
    pattern: {
      id: 50,
      cycleDays: 2,
    },
    days: [{
      id: 500,
      patternId: 50,
      dayIndex: 0,
      isRestDay: false,
    }],
    segments: [{
      patternDayId: 500,
      shiftDefinitionId: 1,
      segmentOrder: 1,
    }],
    shifts,
  }), /missing day index 1/i);
});
