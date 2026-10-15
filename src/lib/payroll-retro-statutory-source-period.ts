/**
 * M-10 contribution-source gate (not an agency interpretation).
 * Use actual referenced Released payroll_run periods, never editable labels.
 * A prior/ambiguous month creates a non-waivable payroll Exception.
 * Source work month is NOT automatically an agency remittance month.
 */
export type RetroStatutorySourcePeriod = {
  id: number;
  amount: number;
  sourcePeriodStart?: string | null;
  sourcePeriodEnd?: string | null;
};

export type RetroAgencyReviewRow = Readonly<{
  adjustmentId: number;
  /** Signed adjustment, not an automatically approved agency correction. */
  amount: number;
  /** For reconciliation exports only; null when money is not representable. */
  amountCentavos: number | null;
  sourceWorkMonth: string | null;
  currentCutoffMonth: string | null;
  status: "same_cutoff_month" | "different_source_month" | "source_unverified" | "invalid_adjustment" | "zero_adjustment";
  /** SSS and HDMF require separately documented determination. */
  requiresAgencyReview: boolean;
}>;

function isIsoDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Read-only source/amount queue for an independent SSS + Pag-IBIG decision.
 * No contribution rates, remittance months, posting instructions, or money
 * movements may be derived from these rows without an approved agency policy.
 */
export function retroAgencyReconciliationRows(input: {
  currentPeriodStart: string;
  currentPeriodEnd: string;
  adjustments: readonly RetroStatutorySourcePeriod[];
}): RetroAgencyReviewRow[] {
  const { currentPeriodStart: start, currentPeriodEnd: end } = input;
  const currentReliable = isIsoDate(start) && isIsoDate(end)
    && start <= end && start.slice(0, 7) === end.slice(0, 7);
  const currentCutoffMonth = currentReliable ? end.slice(0, 7) : null;
  return input.adjustments.map((item) => {
    const { sourcePeriodStart: from, sourcePeriodEnd: to } = item;
    const sourceReliable = isIsoDate(from) && isIsoDate(to)
      && from <= to && from.slice(0, 7) === to.slice(0, 7);
    const sourceWorkMonth = sourceReliable ? to.slice(0, 7) : null;
    const cents = Number.isFinite(item.amount) ? Math.round(item.amount * 100) : NaN;
    const amountCentavos = Number.isSafeInteger(cents) && Math.abs(item.amount * 100 - cents) < 0.000001
      ? cents : null;

    let status: RetroAgencyReviewRow["status"];
    if (!Number.isSafeInteger(item.id) || item.id <= 0 || !Number.isFinite(item.amount)
      || amountCentavos === null) {
      status = "invalid_adjustment";
    } else if (item.amount === 0) {
      status = "zero_adjustment";
    } else if (!currentReliable || !sourceReliable) {
      status = "source_unverified";
    } else if (sourceWorkMonth !== currentCutoffMonth) {
      status = "different_source_month";
    } else {
      status = "same_cutoff_month";
    }

    return {
      adjustmentId: item.id,
      amount: item.amount,
      amountCentavos,
      sourceWorkMonth,
      currentCutoffMonth,
      status,
      requiresAgencyReview: status === "invalid_adjustment"
        || status === "source_unverified" || status === "different_source_month",
    };
  });
}

export function reviewRetroStatutorySourcePeriods(input: {
  currentPeriodStart: string;
  currentPeriodEnd: string;
  adjustments: readonly RetroStatutorySourcePeriod[];
}): string[] {
  const flags: string[] = [];
  for (const row of retroAgencyReconciliationRows(input)) {
    if (row.status === "invalid_adjustment") {
      flags.push("STATUTORY_RETRO_INVALID_SOURCE: A retro adjustment has an invalid identity or amount. Reconcile before release.");
    } else if (row.status === "source_unverified") {
      flags.push("STATUTORY_RETRO_SOURCE_UNVERIFIED: Retro #" + row.adjustmentId
        + " lacks a single verified source month. Reconcile SSS and Pag-IBIG before release.");
    } else if (row.status === "different_source_month") {
      flags.push("STATUTORY_RETRO_PRIOR_MONTH_REVIEW: Retro #" + row.adjustmentId
        + " belongs to a different work month. Verify SSS and Pag-IBIG attribution before release.");
    }
  }
  return flags;
}
