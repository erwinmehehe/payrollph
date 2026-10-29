import { validIsoDate } from "./payroll-period-validation";

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
  // Use the same real-calendar rule as payroll creation and preview.
  // An impossible date must never look like a valid future cutoff.
  return calculated && validIsoDate(periodEnd) && periodEnd > manilaCalendarDate(now);
}

/**
 * Stable human-readable payroll cutoff label. Intl.format with an undefined
 * month option produces environment-specific "2026 (day: 15)" strings on some
 * Node/ICU builds. Compose numeric days explicitly instead of relying on that.
 * The calling payroll route validates ISO calendar dates before formatting.
 */
export function formatPayrollPeriodLabel(periodStart: string, periodEnd: string): string {
  const start = new Date(`${periodStart}T12:00:00Z`);
  const end = new Date(`${periodEnd}T12:00:00Z`);
  const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
  const startMonth = month.format(start);
  const endMonth = month.format(end);
  const startDay = start.getUTCDate();
  const endDay = end.getUTCDate();
  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();
  if (startYear === endYear && start.getUTCMonth() === end.getUTCMonth()) {
    return `${startMonth} ${startDay}–${endDay}, ${endYear}`;
  }
  if (startYear === endYear) {
    return `${startMonth} ${startDay}–${endMonth} ${endDay}, ${endYear}`;
  }
  return `${startMonth} ${startDay}, ${startYear}–${endMonth} ${endDay}, ${endYear}`;
}
