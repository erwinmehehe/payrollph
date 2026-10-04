import type {
  ResolvedDailySchedule,
  ResolvedScheduleSegment,
} from "@/lib/workforce-scheduling";

export type PayrollPunchLike = {
  id: number;
  timeIn: Date | string | null;
};

export type PayrollPunchScheduleResolution = {
  segmentByPunchId: Map<number, ResolvedScheduleSegment>;
  exception: string | null;
};

export function advancedScheduleForPayroll(
  schedule: ResolvedDailySchedule | null | undefined,
) {
  return schedule && schedule.source !== "unassigned" ? schedule : null;
}

export function payrollRestDayFromSchedule(
  schedule: ResolvedDailySchedule | null | undefined,
  legacyIsRestDay: boolean,
) {
  const advanced = advancedScheduleForPayroll(schedule);
  return advanced ? advanced.isRestDay : legacyIsRestDay;
}

function punchSortValue(punch: PayrollPunchLike) {
  if (!punch.timeIn) return Number.POSITIVE_INFINITY;
  const value = punch.timeIn instanceof Date
    ? punch.timeIn.getTime()
    : Date.parse(String(punch.timeIn));
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

/**
 * Associates punches to the effective schedule without guessing.
 *
 * - Unassigned/legacy dates keep their historical punch shift metadata.
 * - Worked rest days also keep punch shift metadata because there is no
 *   scheduled work segment to borrow.
 * - A working day is mapped only when punch count exactly matches the
 *   configured schedule segment count.
 * - Split shifts are paired by actual time-in order to configured
 *   segmentOrder. A mismatch is an explicit payroll exception.
 */
export function matchPunchesToWorkforceSegments(input: {
  date: string;
  schedule: ResolvedDailySchedule | null | undefined;
  punches: PayrollPunchLike[];
}): PayrollPunchScheduleResolution {
  const advanced = advancedScheduleForPayroll(input.schedule);
  if (!advanced || advanced.isRestDay) {
    return { segmentByPunchId: new Map(), exception: null };
  }

  const segments = [...advanced.segments].sort(
    (a, b) => a.segmentOrder - b.segmentOrder,
  );
  if (segments.length === 0) {
    return {
      segmentByPunchId: new Map(),
      exception:
        `${input.date}: advanced workforce schedule is a working day but has no shift segment; attendance pricing was not inferred.`,
    };
  }

  if (segments.length !== input.punches.length) {
    return {
      segmentByPunchId: new Map(),
      exception:
        `${input.date}: workforce schedule has ${segments.length} segment(s) but attendance has ${input.punches.length} punch record(s); verify split/shift attendance before release.`,
    };
  }

  const punches = [...input.punches].sort(
    (a, b) => punchSortValue(a) - punchSortValue(b) || a.id - b.id,
  );
  const segmentByPunchId = new Map<number, ResolvedScheduleSegment>();
  punches.forEach((punch, index) => {
    segmentByPunchId.set(punch.id, segments[index]);
  });

  return { segmentByPunchId, exception: null };
}

export function workforceScheduleTrace(
  schedules: Record<string, ResolvedDailySchedule> | undefined,
) {
  return Object.values(schedules ?? {})
    .filter((schedule) => schedule.source !== "unassigned")
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((schedule) => ({
      date: schedule.date,
      source: schedule.source,
      isRestDay: schedule.isRestDay,
      assignmentId: schedule.assignmentId,
      patternId: schedule.patternId,
      patternDayIndex: schedule.patternDayIndex,
      overrideId: schedule.overrideId,
      workLocationOrgUnitId: schedule.workLocationOrgUnitId,
      segments: schedule.segments.map((segment) => ({
        shiftDefinitionId: segment.shiftDefinitionId,
        shiftCode: segment.shiftCode,
        segmentOrder: segment.segmentOrder,
        startTime: segment.startTime,
        endTime: segment.endTime,
        breakMinutes: segment.breakMinutes,
        spansMidnight: segment.spansMidnight,
      })),
    }));
}
