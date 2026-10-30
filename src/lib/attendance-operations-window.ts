/**
 * Attendance operations are review-only. Never accept invalid Gregorian dates
 * or an unbounded queue range; the sibling analysis API caps at 42 days.
 */
export const MAX_ATTENDANCE_OPERATIONS_DAYS = 42;
const MS_PER_DAY = 86_400_000;
function canonicalDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T00:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
export function validAttendanceOperationsWindow(startDate: string, endDate: string): boolean {
  if (!canonicalDay(startDate) || !canonicalDay(endDate)) return false;
  const start = Date.parse(startDate + "T00:00:00Z");
  const end = Date.parse(endDate + "T00:00:00Z");
  return end >= start && (end - start) / MS_PER_DAY < MAX_ATTENDANCE_OPERATIONS_DAYS;
}
