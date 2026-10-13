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

/**
 * PostgreSQL jsonb reorders object keys when a submitted snapshot is stored.
 * Comparing JSON.stringify(stored) to JSON.stringify(fresh) therefore rejects
 * an unchanged roster. Compare every field recursively, ignoring ONLY object
 * key insertion order. Arrays (shift segment order), extra/missing fields,
 * types and every payroll-relevant field must still match exactly.
 */
function equalSnapshotJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => equalSnapshotJson(value, right[index]));
  }
  const leftFields = left as Record<string, unknown>;
  const rightFields = right as Record<string, unknown>;
  const keys = Object.keys(leftFields);
  return keys.length === Object.keys(rightFields).length
    && keys.every((key) =>
      Object.prototype.hasOwnProperty.call(rightFields, key)
      && equalSnapshotJson(leftFields[key], rightFields[key]));
}

export function scheduleSwapSnapshotsMatch(
  expected: ScheduleSwapSnapshot,
  current: ScheduleSwapSnapshot,
) {
  return equalSnapshotJson(expected, current);
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
