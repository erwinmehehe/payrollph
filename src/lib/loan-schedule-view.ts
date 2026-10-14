export type LoanScheduleRow = { installment: number; date: string; amount: number; projectedBalance: number };

/**
 * Display-only monthly projection from the remaining ledger balance.
 * The date is a YYYY-MM illustration, NOT a due date or payroll authorization.
 */
export function loanDisplaySchedule(input: {
  balance: string | number;
  installment: string | number;
  startsOn: string | null;
  status: string;
  asOf?: Date;
}): LoanScheduleRow[] {
  const cents = (value: string | number): number => {
    const raw = String(value).trim();
    if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(raw)) return Number.NaN;
    const [whole, fractional = ""] = raw.split(".");
    const amount = Number(whole) * 100 + Number(fractional.padEnd(2, "0"));
    return Number.isSafeInteger(amount) ? amount : Number.NaN;
  };
  let remaining = cents(input.balance);
  const monthly = cents(input.installment);
  // A paused, ended or unapproved loan must not imply a live repayment schedule.
  if (!Number.isSafeInteger(remaining) || !Number.isSafeInteger(monthly) ||
      remaining <= 0 || monthly <= 0 || !input.startsOn ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.startsOn) || input.status !== "active") return [];

  const start = new Date(input.startsOn + "T00:00:00.000Z");
  if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== input.startsOn) return [];
  const asOf = input.asOf ?? new Date();
  if (!Number.isFinite(asOf.getTime())) return [];
  const phParts = new Intl.DateTimeFormat("en-US", {
    year: "numeric", month: "2-digit", timeZone: "Asia/Manila",
  }).formatToParts(asOf);
  const year = Number(phParts.find(part => part.type === "year")?.value);
  const month = Number(phParts.find(part => part.type === "month")?.value);
  if (!Number.isSafeInteger(year) || !Number.isSafeInteger(month) || month < 1 || month > 12) return [];
  // A remaining balance is today's snapshot. Never restart a projection in a past month.
  const firstMonthIndex = Math.max(start.getUTCFullYear() * 12 + start.getUTCMonth(), year * 12 + month - 1);
  const rows: LoanScheduleRow[] = [];
  // 120 illustrations maximum; the source ledger remains authoritative.
  while (remaining > 0 && rows.length < 120) {
    const paid = Math.min(remaining, monthly);
    remaining -= paid;
    const monthIndex = firstMonthIndex + rows.length;
    const illustrativeMonth = new Date(Date.UTC(Math.floor(monthIndex / 12), monthIndex % 12, 1))
      .toISOString().slice(0, 7);
    rows.push({ installment: rows.length + 1, date: illustrativeMonth,
      amount: paid / 100, projectedBalance: remaining / 100 });
  }
  return rows;
}
