/** Shared cutoff-date rules for the payroll-run API and its read-only preview.
 * Keep validation consistent: a preview must not be ready for a period the
 * authoritative payroll-run endpoint refuses.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
export const MAX_PAYROLL_PERIOD_DAYS = 16;

export function validIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function inclusivePeriodDays(periodStart: string, periodEnd: string): number {
  const start = Date.parse(`${periodStart}T00:00:00Z`);
  const end = Date.parse(`${periodEnd}T00:00:00Z`);
  return Math.floor((end - start) / DAY_MS) + 1;
}
