/**
 * Convert an actual instant to its Philippine civil calendar date.
 *
 * Do not derive a new employee's default start date from UTC or the
 * administrator's device timezone: around midnight in the Philippines that
 * can silently set the previous date and affect employment/payroll history.
 * This formats a display/form default only; authoritative startDate remains
 * user-editable and server-validated by the existing employee API.
 */
const manilaCalendarFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function philippineCalendarDay(instant: Date): string {
  const tokens = manilaCalendarFormatter.formatToParts(instant);
  const part = (type: "year" | "month" | "day") =>
    tokens.find((token) => token.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (!year || !month || !day) {
    throw new RangeError("Unable to resolve Philippine calendar date.");
  }
  return `${year}-${month}-${day}`;
}

/** Flag OFF preserves the original UTC form default byte for byte. */
export function newHireCalendarDay(instant: Date, enabled = false): string {
  return enabled ? philippineCalendarDay(instant) : instant.toISOString().slice(0, 10);
}
