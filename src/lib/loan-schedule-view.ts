export type LoanScheduleRow = { installment: number; date: string; amount: number; projectedBalance: number };

/** Display-only schedule, never replaces the payroll loan ledger or statutory deductions. */
export function loanDisplaySchedule(input: {
  balance: string | number;
  installment: string | number;
  startsOn: string | null;
  status: string;
}): LoanScheduleRow[] {
  const cents = (value: string | number) => Math.round(Number(value) * 100);
  let remaining = cents(input.balance), monthly = cents(input.installment);
  if (!Number.isSafeInteger(remaining) || !Number.isSafeInteger(monthly) ||
    remaining <= 0 || monthly <= 0 || !input.startsOn ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.startsOn) || !["active","paused"].includes(input.status)) return [];
  const date = new Date(input.startsOn + "T00:00:00Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== input.startsOn) return [];
  const rows: LoanScheduleRow[] = [];
  // 120 installments is a display cap; caller still sees total authoritative balance.
  while (remaining > 0 && rows.length < 120) {
    const paid = Math.min(remaining, monthly);
    remaining -= paid;
    const step = rows.length;
    const due = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + step, Math.min(date.getUTCDate(), 28)));
    rows.push({ installment: step + 1, date: due.toISOString().slice(0,10),
      amount: paid / 100, projectedBalance: remaining / 100 });
  }
  return rows;
}
