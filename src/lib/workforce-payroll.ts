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

export type PayableTimeSegment = {
  punchId: number;
  sourceWorkDate: string;
  calendarDate: string;
  start: string;
  end: string;
  minutes: number;
  overtime: boolean;
  night: boolean;
};

export type PayableTimeSegmentation = {
  segments: PayableTimeSegment[];
  attendanceCalendarDates: string[];
  allocationComplete: boolean;
  flags: string[];
};

// Keep the machine-readable warning stable across segmentation, the stored
// payroll trace and checker/release assurance. A free-text warning alone is
// insufficient for a financial release gate.
export const WFM_PREMIUM_ALLOCATION_UNVERIFIED = "WFM_PREMIUM_ALLOCATION_UNVERIFIED";

/**
 * Returns only payroll-blocking pricing evidence flags. An unlocated break in
 * one price bucket can remain reviewable, but an ambiguous boundary, or a
 * complete worked punch that cannot be segmented at all, cannot be waived.
 */
export function payableTimeEvidenceFlagsForPayroll(
  segmentation: PayableTimeSegmentation,
  derivedWorkedMinutes: number,
): string[] {
  // Missing price segments for independently derived worked minutes must
  // block approval even when an upstream caller unexpectedly forgot to emit
  // a flag or marked the segmentation complete.
  // Never silently treat malformed worked-minute evidence as zero.
  // NaN and Infinity would otherwise bypass the no-segments check.
  if (!Number.isSafeInteger(derivedWorkedMinutes) || derivedWorkedMinutes < 0) {
    return [`${WFM_PREMIUM_ALLOCATION_UNVERIFIED}: Derived worked minutes are invalid; reconcile attendance and break evidence before payroll approval.`];
  }
  const unpricedWorkedTime = segmentation.segments.length === 0 && derivedWorkedMinutes > 0;
  // A persistent machine-readable financial blocker always wins, even if an
  // upstream caller mistakenly marks otherwise plausible segments complete.
  const mandatoryCorrection = segmentation.flags.some((flag) =>
    flag.startsWith(`${WFM_PREMIUM_ALLOCATION_UNVERIFIED}:`),
  );
  if (segmentation.allocationComplete && !unpricedWorkedTime && !mandatoryCorrection) return [];

  const pricingClasses = new Set(segmentation.segments.map((segment) =>
    `${segment.calendarDate}|${segment.overtime ? "ot" : "regular"}|${segment.night ? "night" : "day"}`,
  ));
  if (!mandatoryCorrection && !unpricedWorkedTime && pricingClasses.size <= 1) return [];
  const evidence = segmentation.flags.length > 0 ? segmentation.flags : [
    "Worked attendance has no payable-time price segments; independent premium allocation is required before payroll approval.",
  ];

  return evidence.map((flag) =>
    flag.startsWith(`${WFM_PREMIUM_ALLOCATION_UNVERIFIED}:`)
      ? flag
      : `${WFM_PREMIUM_ALLOCATION_UNVERIFIED}: ${flag}`,
  );
}

const PH_OFFSET_MS = 8 * 60 * 60_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function isRealPhWorkDate(value: string) {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

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

function asInstant(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function addIsoDays(dateText: string, days: number) {
  const value = new Date(`${dateText}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function phDateText(value: Date) {
  return new Date(value.getTime() + PH_OFFSET_MS).toISOString().slice(0, 10);
}

function phMinutesOfDay(value: Date) {
  const shifted = new Date(value.getTime() + PH_OFFSET_MS);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

function phInstant(dateText: string, timeText: string) {
  const normalized = timeText.length === 5 ? `${timeText}:00` : timeText;
  const value = new Date(`${dateText}T${normalized}+08:00`);
  return Number.isFinite(value.getTime()) ? value : null;
}

function calendarDatesTouched(start: Date, end: Date) {
  if (end <= start) return [];
  const first = phDateText(start);
  const last = phDateText(new Date(end.getTime() - 1));
  const dates: string[] = [];
  for (
    let date = first, guard = 0;
    date <= last && guard < 8;
    date = addIsoDays(date, 1), guard += 1
  ) {
    dates.push(date);
  }
  return dates;
}

function addBoundary(
  boundaries: Map<number, Date>,
  boundary: Date | null,
  start: Date,
  end: Date,
) {
  if (!boundary) return;
  const value = boundary.getTime();
  if (value > start.getTime() && value < end.getTime()) {
    boundaries.set(value, boundary);
  }
}

/**
 * Splits one attendance punch into payroll-pricing segments using actual
 * Philippine wall-clock boundaries.
 *
 * Boundaries are created at:
 * - each local midnight, so holiday/rest-day classification can change;
 * - 06:00 and 22:00, so night differential never leaks into daytime;
 * - scheduled shift end, so overtime is independently priceable;
 * - an explicitly located break.
 *
 * If a scheduled meal break has no actual break timestamps, the structural
 * segments are still returned for audit, but allocationComplete is false.
 * Payroll must then keep its legacy calculation and require review instead of
 * guessing which premium bucket contained the break.
 */
export function segmentPayableTime(input: {
  punch: {
    id: number;
    workDate: string;
    timeIn: Date | string | null;
    timeOut: Date | string | null;
    breakStart?: Date | string | null;
    breakEnd?: Date | string | null;
  };
  shift: {
    start: string;
    end: string;
    breakMinutes?: number;
    spansMidnight?: boolean;
  };
}): PayableTimeSegmentation {
  const flags: string[] = [];
  const actualIn = asInstant(input.punch.timeIn);
  const actualOut = asInstant(input.punch.timeOut);

  if (!isRealPhWorkDate(input.punch.workDate)) {
    return {
      segments: [],
      attendanceCalendarDates: [],
      allocationComplete: false,
      flags: ["Payable-time segmentation requires a real YYYY-MM-DD work date."],
    };
  }
  if (!TIME_OF_DAY.test(input.shift.start) || !TIME_OF_DAY.test(input.shift.end)) {
    return {
      segments: [],
      attendanceCalendarDates: [],
      allocationComplete: false,
      flags: ["Payable-time segmentation requires valid 24-hour shift start/end times."],
    };
  }
  if (!actualIn || !actualOut || actualOut <= actualIn) {
    return {
      segments: [],
      attendanceCalendarDates: [],
      allocationComplete: false,
      flags: ["Payable-time segmentation requires a complete, valid punch pair."],
    };
  }

  // Work date is an authoritative payroll pricing input. If it is several
  // calendar days away from the actual Philippine clock-in date, using that
  // date to derive scheduled overtime could price the entire punch wrongly.
  // Adjacent dates remain valid for early and overnight clock-ins.
  const firstPunchDate = phDateText(actualIn);
  const earliestWorkDate = addIsoDays(input.punch.workDate, -1);
  const latestWorkDate = addIsoDays(input.punch.workDate, 1);
  if (firstPunchDate < earliestWorkDate || firstPunchDate > latestWorkDate) {
    return {
      segments: [],
      attendanceCalendarDates: [],
      allocationComplete: false,
      flags: [`${WFM_PREMIUM_ALLOCATION_UNVERIFIED}: Punch clock-in and source work date differ by more than one Philippine calendar day; reconcile the actual work date before payroll approval.`],
    };
  }

  const attendanceCalendarDates = calendarDatesTouched(actualIn, actualOut);
  // The boundary enumerator is deliberately capped at eight PH calendar dates.
  // Never silently price the remainder of a longer punch without its midnight
  // and night-differential boundaries. Such evidence requires manual correction.
  if (attendanceCalendarDates.at(-1) !== phDateText(new Date(actualOut.getTime() - 1))) {
    return {
      segments: [],
      attendanceCalendarDates,
      allocationComplete: false,
      flags: [`${WFM_PREMIUM_ALLOCATION_UNVERIFIED}: Attendance punch exceeds eight Philippine calendar dates; premium allocation requires correction before payroll approval.`],
    };
  }
  const crossesMidnight =
    Boolean(input.shift.spansMidnight) || input.shift.end <= input.shift.start;
  const shiftEndDate = crossesMidnight
    ? addIsoDays(input.punch.workDate, 1)
    : input.punch.workDate;
  const scheduledEnd = phInstant(shiftEndDate, input.shift.end);
  if (!scheduledEnd) {
    return {
      segments: [],
      attendanceCalendarDates,
      allocationComplete: false,
      flags: ["Scheduled shift end could not be resolved for payable-time segmentation."],
    };
  }

  // Invalid schedule break lengths must not silently become zero or NaN.
  // A malformed break changes payable minutes and can distort premium buckets.
  const scheduledBreakMinutes = input.shift.breakMinutes ?? 0;
  if (!Number.isSafeInteger(scheduledBreakMinutes)
    || scheduledBreakMinutes < 0 || scheduledBreakMinutes > 24 * 60) {
    return {
      segments: [],
      attendanceCalendarDates,
      allocationComplete: false,
      flags: [`${WFM_PREMIUM_ALLOCATION_UNVERIFIED}: Scheduled break duration is invalid; reconcile the schedule before payroll approval.`],
    };
  }
  const breakStart = asInstant(input.punch.breakStart);
  const breakEnd = asInstant(input.punch.breakEnd);
  let locatedBreak: { start: Date; end: Date } | null = null;
  let allocationComplete = true;

  if (breakStart || breakEnd) {
    if (
      !breakStart
      || !breakEnd
      || breakEnd <= breakStart
      || breakStart < actualIn
      || breakEnd > actualOut
    ) {
      allocationComplete = false;
      flags.push(
        "Break timestamps are incomplete or invalid; premium allocation was not inferred.",
      );
    } else {
      locatedBreak = { start: breakStart, end: breakEnd };
    }
  } else if (scheduledBreakMinutes > 0) {
    allocationComplete = false;
    flags.push(
      `Scheduled ${scheduledBreakMinutes}-minute break has no actual location; cross-boundary premium allocation requires review.`,
    );
  }

  const boundaries = new Map<number, Date>([
    [actualIn.getTime(), actualIn],
    [actualOut.getTime(), actualOut],
  ]);
  addBoundary(boundaries, scheduledEnd, actualIn, actualOut);
  if (locatedBreak) {
    addBoundary(boundaries, locatedBreak.start, actualIn, actualOut);
    addBoundary(boundaries, locatedBreak.end, actualIn, actualOut);
  }

  for (const dateText of attendanceCalendarDates) {
    addBoundary(boundaries, phInstant(dateText, "00:00"), actualIn, actualOut);
    addBoundary(boundaries, phInstant(dateText, "06:00"), actualIn, actualOut);
    addBoundary(boundaries, phInstant(dateText, "22:00"), actualIn, actualOut);
    addBoundary(
      boundaries,
      phInstant(addIsoDays(dateText, 1), "00:00"),
      actualIn,
      actualOut,
    );
  }

  const points = [...boundaries.values()].sort(
    (a, b) => a.getTime() - b.getTime(),
  );
  const segments: PayableTimeSegment[] = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (end <= start) continue;

    const midpoint = (start.getTime() + end.getTime()) / 2;
    if (
      locatedBreak
      && midpoint >= locatedBreak.start.getTime()
      && midpoint < locatedBreak.end.getTime()
    ) {
      continue;
    }

    const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
    if (minutes <= 0) continue;

    const minuteOfDay = phMinutesOfDay(start);
    segments.push({
      punchId: input.punch.id,
      sourceWorkDate: input.punch.workDate,
      calendarDate: phDateText(start),
      start: start.toISOString(),
      end: end.toISOString(),
      minutes,
      overtime: start.getTime() >= scheduledEnd.getTime(),
      night: minuteOfDay >= 22 * 60 || minuteOfDay < 6 * 60,
    });
  }

  return {
    segments,
    attendanceCalendarDates,
    allocationComplete,
    flags,
  };
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
    }));
}
