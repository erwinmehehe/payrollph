/** Philippine-local dates for UI labels; approval policy remains enforced on the server. */
export function manilaCalendarDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** An in-progress payroll calculation is an estimate until the period closes. */
export function isPreliminaryPayroll(
  periodEnd: string,
  calculated: boolean,
  now: Date = new Date(),
): boolean {
  return calculated && /^\d{4}-\d{2}-\d{2}$/.test(periodEnd) && periodEnd > manilaCalendarDate(now);
}
