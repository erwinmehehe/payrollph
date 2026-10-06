export type ApprovedLeaveRange = {
  id: number;
  employeeId: number;
  startDate: string;
  endDate: string;
  days: number;
  leaveType?: string;
};

function isoDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Date must use YYYY-MM-DD.");
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

export function calendarDaysInclusive(startDate: string, endDate: string) {
  const start = isoDay(startDate);
  const end = isoDay(endDate);
  if (end < start) throw new Error("Leave end date cannot be before start date.");
  return Math.floor((end - start) / 86_400_000) + 1;
}

export function approvedLeaveContainsDate(
  leave: Pick<ApprovedLeaveRange, "startDate" | "endDate">,
  date: string,
) {
  return date >= leave.startDate && date <= leave.endDate;
}

/**
 * Existing leave stores one day total for a date range, not per-day timing.
 * Only treat a date as definitely full-day absent when the request's day count
 * covers every calendar date in the range. Anything fractional/ambiguous is
 * surfaced instead of guessed into shift hours.
 */
export function approvedLeaveCoverageImpact(leave: ApprovedLeaveRange) {
  const calendarDays = calendarDaysInclusive(leave.startDate, leave.endDate);
  const days = Number(leave.days);
  if (!Number.isFinite(days) || days <= 0) {
    return { kind: "invalid" as const, calendarDays };
  }
  if (days + 1e-9 >= calendarDays) {
    return { kind: "full_day" as const, calendarDays };
  }
  return { kind: "ambiguous_partial" as const, calendarDays };
}

export function approvedLeaveConflictsFullShift(input: {
  leaves: ApprovedLeaveRange[];
  employeeId: number;
  workDate: string;
}) {
  const overlaps = input.leaves.filter(
    (leave) => leave.employeeId === input.employeeId && approvedLeaveContainsDate(leave, input.workDate),
  );
  return {
    conflict: overlaps.length > 0,
    overlaps,
    fullDay: overlaps.some((leave) => approvedLeaveCoverageImpact(leave).kind === "full_day"),
    ambiguous: overlaps.some((leave) => approvedLeaveCoverageImpact(leave).kind !== "full_day"),
  };
}

export type ClockPreciseLeave = ApprovedLeaveRange & {
  window?: {
    workDate: string;
    startTime: string;
    endTime: string;
    minutes: number;
  } | null;
};

function minuteOfDay(time: string) {
  if (!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(time)) throw new Error("Clock time must be HH:mm.");
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function preciseLeaveMinutes(startTime: string, endTime: string) {
  const minutes = minuteOfDay(endTime) - minuteOfDay(startTime);
  if (minutes <= 0) throw new Error("Timed leave must end after its start on the same day.");
  return minutes;
}

export function preciseLeaveDayEquivalent(minutes: number, standardDayMinutes: number) {
  if (!Number.isInteger(minutes) || !Number.isInteger(standardDayMinutes)
    || standardDayMinutes < 60 || standardDayMinutes > 1440
    || minutes < 1 || minutes > standardDayMinutes) {
    throw new Error("Timed leave minutes must not exceed the employee's configured standard workday.");
  }
  return Math.round((minutes / standardDayMinutes) * 10_000) / 10_000;
}

function utcWallDay(date: string) { return isoDay(date); }
const MINUTE = 60_000;
const DAY = 86_400_000;

export function approvedLeaveShiftConflict(input: {
  leaves: ClockPreciseLeave[];
  employeeId: number;
  workDate: string;
  shift: { startTime: string; endTime: string; spansMidnight: boolean };
}) {
  const shiftStart = utcWallDay(input.workDate) + minuteOfDay(input.shift.startTime.slice(0, 5)) * MINUTE;
  let shiftEnd = utcWallDay(input.workDate) + minuteOfDay(input.shift.endTime.slice(0, 5)) * MINUTE;
  if (input.shift.spansMidnight || shiftEnd <= shiftStart) shiftEnd += DAY;
  const overlapping: ClockPreciseLeave[] = [];
  let overlapMinutes = 0;
  let ambiguous = false;

  for (const leave of input.leaves.filter((item) => item.employeeId === input.employeeId)) {
    if (leave.window) {
      const start = utcWallDay(leave.window.workDate) + minuteOfDay(leave.window.startTime) * MINUTE;
      const end = utcWallDay(leave.window.workDate) + minuteOfDay(leave.window.endTime) * MINUTE;
      const minutes = Math.max(0, (Math.min(end, shiftEnd) - Math.max(start, shiftStart)) / MINUTE);
      if (minutes > 0) { overlapping.push(leave); overlapMinutes += minutes; }
      continue;
    }
    const start = utcWallDay(leave.startDate);
    const end = utcWallDay(leave.endDate) + DAY;
    if (Math.min(end, shiftEnd) <= Math.max(start, shiftStart)) continue;
    overlapping.push(leave);
    if (approvedLeaveCoverageImpact(leave).kind !== "full_day") ambiguous = true;
    else overlapMinutes += (Math.min(end, shiftEnd) - Math.max(start, shiftStart)) / MINUTE;
  }

  return {
    conflict: overlapping.length > 0,
    ambiguous,
    overlapMinutes: Math.min(Math.round(overlapMinutes), Math.round((shiftEnd - shiftStart) / MINUTE)),
    overlaps: overlapping,
  };
}
