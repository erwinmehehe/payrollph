import type { ResolvedDailySchedule, WorkforceScheduleOverride, WorkforceScheduleOverrideSegment } from "@/lib/workforce-scheduling";

export type ScheduleSwapSnapshot = {
  date: string;
  source: "pattern" | "override" | "unassigned";
  isRestDay: boolean;
  assignmentId: number | null;
  patternId: number | null;
  patternDayIndex: number | null;
  overrideId: number | null;
  workLocationOrgUnitId: number | null;
  worksiteId: number | null;
  segments: Array<{
    shiftDefinitionId: number;
    shiftCode: string;
    segmentOrder: number;
    startTime: string;
    endTime: string;
    breakMinutes: number;
    spansMidnight: boolean;
  }>;
};

export function scheduleSwapSnapshot(schedule: ResolvedDailySchedule): ScheduleSwapSnapshot {
  return {
    date: schedule.date,
    source: schedule.source,
    isRestDay: schedule.isRestDay,
    assignmentId: schedule.assignmentId,
    patternId: schedule.patternId,
    patternDayIndex: schedule.patternDayIndex,
    overrideId: schedule.overrideId,
    workLocationOrgUnitId: schedule.workLocationOrgUnitId,
    worksiteId: schedule.worksiteId,
    segments: schedule.segments.map((segment) => ({
      shiftDefinitionId: segment.shiftDefinitionId,
      shiftCode: segment.shiftCode,
      segmentOrder: segment.segmentOrder,
      startTime: segment.startTime,
      endTime: segment.endTime,
      breakMinutes: segment.breakMinutes,
      spansMidnight: segment.spansMidnight,
    })),
  };
}

export function assertScheduleSwappable(snapshot: ScheduleSwapSnapshot) {
  if (snapshot.source === "unassigned") {
    throw new Error(`${snapshot.date}: schedule swap cannot use an unassigned workforce day.`);
  }
  if (snapshot.overrideId != null || snapshot.source === "override") {
    throw new Error(
      `${snapshot.date}: schedule swap cannot stack on an existing day-level override; resolve that override first.`,
    );
  }
  if (!snapshot.isRestDay && snapshot.segments.length === 0) {
    throw new Error(`${snapshot.date}: working schedule has no shift segment and cannot be swapped safely.`);
  }
}

export function scheduleSwapSnapshotsMatch(
  expected: ScheduleSwapSnapshot,
  current: ScheduleSwapSnapshot,
) {
  return JSON.stringify(expected) === JSON.stringify(current);
}

export function scheduleSwapOverrideValues(
  incoming: ScheduleSwapSnapshot,
  reason: string,
): {
  kind: WorkforceScheduleOverride["kind"];
  isRestDay: boolean;
  segments: WorkforceScheduleOverrideSegment[];
  workLocationOrgUnitId: number | null;
  worksiteId: number | null;
  reason: string;
} {
  assertScheduleSwappable(incoming);
  return {
    kind: incoming.isRestDay
      ? "rest_day"
      : incoming.segments.length > 1
        ? "split_shift"
        : "shift",
    isRestDay: incoming.isRestDay,
    segments: incoming.segments.map((segment) => ({
      shiftDefinitionId: segment.shiftDefinitionId,
      segmentOrder: segment.segmentOrder,
    })),
    workLocationOrgUnitId: incoming.workLocationOrgUnitId,
    worksiteId: incoming.worksiteId,
    reason,
  };
}
