import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SCHEDULE_GUARDRAIL_POLICY,
  evaluateScheduleGuardrails,
  scheduleGuardrailBlocksMutation,
  type ScheduleGuardrailPolicy,
} from "../src/lib/workforce-schedule-guardrails";
import type { ResolvedDailySchedule } from "../src/lib/workforce-scheduling";

function day(
  date: string,
  segments: Array<{
    code: string;
    start: string;
    end: string;
    breakMinutes?: number;
    spansMidnight?: boolean;
  }>,
): ResolvedDailySchedule {
  return {
    date,
    source: "pattern",
    isRestDay: segments.length === 0,
    assignmentId: 1,
    patternId: 1,
    patternDayIndex: 0,
    overrideId: null,
    workLocationOrgUnitId: null,
    worksiteId: 1,
    segments: segments.map((segment, index) => ({
      shiftDefinitionId: index + 1,
      shiftCode: segment.code,
      shiftName: segment.code,
      segmentOrder: index + 1,
      startTime: segment.start,
      endTime: segment.end,
      breakMinutes: segment.breakMinutes ?? 0,
      spansMidnight: segment.spansMidnight ?? segment.end <= segment.start,
    })),
    audit: [],
  };
}

test("overlapping scheduled segments are always blocking even when policy is inactive", () => {
  const issues = evaluateScheduleGuardrails({
    days: [day("2026-10-01", [
      { code: "A", start: "08:00", end: "14:00" },
      { code: "B", start: "13:00", end: "17:00" },
    ])],
    policy: { ...DEFAULT_SCHEDULE_GUARDRAIL_POLICY, active: false },
  });

  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "segment_overlap");
  assert.equal(issues[0].blocking, true);
  assert.equal(scheduleGuardrailBlocksMutation(issues), true);
});

test("nested shifts cannot bypass overlap detection when the immediate previous shift ends early", () => {
  const issues = evaluateScheduleGuardrails({
    days: [day("2026-10-01", [
      { code: "LONG", start: "08:00", end: "20:00" },
      { code: "SHORT", start: "09:00", end: "10:00" },
      { code: "NESTED", start: "11:00", end: "12:00" },
    ])],
    policy: { ...DEFAULT_SCHEDULE_GUARDRAIL_POLICY, active: false },
  });
  assert.equal(issues.filter((issue) => issue.code === "segment_overlap").length, 2);
  assert.equal(scheduleGuardrailBlocksMutation(issues), true);
});

test("minimum rest uses the longest occupied interval after nested overlap", () => {
  const issues = evaluateScheduleGuardrails({
    days: [
      day("2026-10-01", [
        { code: "LONG", start: "08:00", end: "20:00" },
        { code: "NESTED", start: "09:00", end: "10:00" },
      ]),
      day("2026-10-02", [{ code: "NEXT", start: "01:00", end: "09:00" }]),
    ],
    policy: {
      ...DEFAULT_SCHEDULE_GUARDRAIL_POLICY,
      minimumRestMinutes: 8 * 60,
      enforcementMode: "block",
    },
  });
  const rest = issues.find((issue) => issue.code === "minimum_rest");
  assert.ok(rest);
  assert.equal(rest.actualMinutes, 300);
  assert.equal(rest.blocking, true);
});

test("minimum rest policy handles cross-midnight work and stays advisory in advisory mode", () => {
  const policy: ScheduleGuardrailPolicy = {
    ...DEFAULT_SCHEDULE_GUARDRAIL_POLICY,
    minimumRestMinutes: 8 * 60,
    enforcementMode: "advisory",
  };
  const issues = evaluateScheduleGuardrails({
    days: [
      day("2026-10-01", [{ code: "NIGHT", start: "22:00", end: "06:00", spansMidnight: true }]),
      day("2026-10-02", [{ code: "DAY", start: "10:00", end: "18:00" }]),
    ],
    policy,
  });

  const rest = issues.find((issue) => issue.code === "minimum_rest");
  assert.ok(rest);
  assert.equal(rest.actualMinutes, 240);
  assert.equal(rest.thresholdMinutes, 480);
  assert.equal(rest.blocking, false);
  assert.equal(scheduleGuardrailBlocksMutation(issues), false);
});

test("blocking mode converts company-policy breaches into mutation blockers", () => {
  const issues = evaluateScheduleGuardrails({
    days: [
      day("2026-10-01", [{ code: "NIGHT", start: "22:00", end: "06:00", spansMidnight: true }]),
      day("2026-10-02", [{ code: "DAY", start: "10:00", end: "18:00" }]),
    ],
    policy: {
      ...DEFAULT_SCHEDULE_GUARDRAIL_POLICY,
      minimumRestMinutes: 480,
      enforcementMode: "block",
    },
  });

  assert.equal(issues.some((issue) => issue.code === "minimum_rest" && issue.blocking), true);
  assert.equal(scheduleGuardrailBlocksMutation(issues), true);
});

test("consecutive working-day policy flags the first day beyond the configured streak", () => {
  const days = Array.from({ length: 7 }, (_, index) =>
    day(`2026-10-${String(index + 1).padStart(2, "0")}`, [
      { code: "DAY", start: "09:00", end: "17:00" },
    ]),
  );

  const issues = evaluateScheduleGuardrails({
    days,
    policy: {
      ...DEFAULT_SCHEDULE_GUARDRAIL_POLICY,
      maxConsecutiveWorkingDays: 6,
    },
  });

  const streak = issues.find((issue) => issue.code === "consecutive_days");
  assert.ok(streak);
  assert.equal(streak.date, "2026-10-07");
  assert.equal(streak.actualDays, 7);
  assert.equal(streak.thresholdDays, 6);
});

test("rolling seven-day policy totals scheduled paid minutes after breaks", () => {
  const days = Array.from({ length: 7 }, (_, index) =>
    day(`2026-10-${String(index + 1).padStart(2, "0")}`, [
      { code: "DAY", start: "08:00", end: "17:00", breakMinutes: 60 },
    ]),
  );

  const issues = evaluateScheduleGuardrails({
    days,
    policy: {
      ...DEFAULT_SCHEDULE_GUARDRAIL_POLICY,
      rollingSevenDayMinutes: 48 * 60,
    },
  });

  const hours = issues.find((issue) =>
    issue.code === "rolling_seven_day_minutes" && issue.date === "2026-10-07"
  );
  assert.ok(hours);
  assert.equal(hours.actualMinutes, 56 * 60);
  assert.equal(hours.thresholdMinutes, 48 * 60);
});

test("zero-valued thresholds are disabled instead of inventing policy", () => {
  const issues = evaluateScheduleGuardrails({
    days: [
      day("2026-10-01", [{ code: "NIGHT", start: "22:00", end: "06:00", spansMidnight: true }]),
      day("2026-10-02", [{ code: "DAY", start: "06:30", end: "18:00" }]),
    ],
    policy: DEFAULT_SCHEDULE_GUARDRAIL_POLICY,
  });
  assert.deepEqual(issues, []);
});
