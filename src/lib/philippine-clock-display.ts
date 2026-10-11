/**
 * Clock display for employees and managers regardless of the viewer's device
 * timezone. The API records authoritative UTC instants; display formatting
 * does not change stored punches, attendance cutoffs, or payable hours.
 */
const clockFormatter = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
});

const calendarFormatter = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
});

export function philippineClockTime(instant: Date): string {
  return clockFormatter.format(instant);
}

export function philippineClockDate(instant: Date): string {
  return calendarFormatter.format(instant);
}
