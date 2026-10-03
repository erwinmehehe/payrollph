import { createHash } from "node:crypto";
import type { HolidayCalendarEntry } from "@/lib/wage-orders";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateParts(value: string) {
  if (!ISO_DATE.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    day: date.getUTCDate(),
  };
}

export function isCanonicalPhSemiMonthlyPeriod(periodStart: string, periodEnd: string) {
  const start = dateParts(periodStart);
  const end = dateParts(periodEnd);
  if (!start || !end || start.year !== end.year || start.month !== end.month) return false;

  if (start.day === 1 && end.day === 15) return true;
  if (start.day !== 16) return false;

  const lastDay = new Date(Date.UTC(start.year, start.month + 1, 0)).getUTCDate();
  return end.day === lastDay;
}

export function phSemiMonthlyCutoff(periodStart: string, periodEnd: string) {
  if (!isCanonicalPhSemiMonthlyPeriod(periodStart, periodEnd)) return null;
  return Number(periodStart.slice(8, 10)) === 1 ? "first" as const : "second" as const;
}


export function holidayCalendarFingerprint(calendar: readonly HolidayCalendarEntry[]) {
  const normalized = calendar
    .map((holiday) => ({
      date: holiday.date,
      kind: holiday.kind,
      name: holiday.name.trim(),
    }))
    .sort((a, b) =>
      a.date.localeCompare(b.date)
      || a.kind.localeCompare(b.kind)
      || a.name.localeCompare(b.name)
    );
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}
