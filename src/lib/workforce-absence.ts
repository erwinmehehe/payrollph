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
