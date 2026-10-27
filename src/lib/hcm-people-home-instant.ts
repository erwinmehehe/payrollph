/**
 * Read-only People Home presentation timestamps.
 * A malformed source instant is unknown, not an invented workflow deadline.
 * No timezone-free strings, date rollovers, payroll or schedule inference.
 */
export function recordedPeopleHomeInstant(
  value: Date | string | null | undefined,
): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  if (typeof value !== "string") return null;

  // Accept only an ISO date+time with an explicit UTC marker or offset.
  // Date alone may normalize February 30 or 24:00 into a different day.
  const match = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:0\d|1\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match) return null;
  const calendar = new Date(match[1] + "T00:00:00.000Z");
  if (!Number.isFinite(calendar.getTime()) ||
      calendar.toISOString().slice(0, 10) !== match[1]) return null;

  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) ? instant.toISOString() : null;
}
