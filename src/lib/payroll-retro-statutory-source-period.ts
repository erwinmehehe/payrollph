/**
 * M-10 contribution-source gate (not an agency interpretation).
 * Use actual referenced payroll_run periods, never editable source labels.
 * A prior/ambiguous month creates a payroll Exception and must not silently
 * be treated as certified current-month SSS/Pag-IBIG remuneration.
 */
export type RetroStatutorySourcePeriod = {
  id: number;
  amount: number;
  sourcePeriodStart?: string | null;
  sourcePeriodEnd?: string | null;
};

function isIsoDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function reviewRetroStatutorySourcePeriods(input: {
  currentPeriodStart: string;
  currentPeriodEnd: string;
  adjustments: readonly RetroStatutorySourcePeriod[];
}): string[] {
  const flags: string[] = [];
  const start = input.currentPeriodStart;
  const end = input.currentPeriodEnd;
  const currentMonthReliable = isIsoDate(start) && isIsoDate(end)
    && start <= end && start.slice(0, 7) === end.slice(0, 7);
  for (const item of input.adjustments) {
    if (!Number.isSafeInteger(item.id) || item.id <= 0 || !Number.isFinite(item.amount)) {
      flags.push("STATUTORY_RETRO_INVALID_SOURCE: A retro adjustment has an invalid identity or amount. Reconcile before release.");
      continue;
    }
    if (item.amount === 0) continue;
    const from = item.sourcePeriodStart;
    const to = item.sourcePeriodEnd;
    if (!currentMonthReliable || !isIsoDate(from) || !isIsoDate(to)
      || from > to || from.slice(0, 7) !== to.slice(0, 7)) {
      flags.push("STATUTORY_RETRO_SOURCE_UNVERIFIED: Retro #" + item.id
        + " lacks a single verified source month. Reconcile SSS and Pag-IBIG before release.");
      continue;
    }
    if (from.slice(0, 7) !== end.slice(0, 7)) {
      flags.push("STATUTORY_RETRO_PRIOR_MONTH_REVIEW: Retro #" + item.id
        + " belongs to a different work month. Verify SSS and Pag-IBIG attribution before release.");
    }
  }
  return flags;
}
