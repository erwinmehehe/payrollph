/**
 * Read-only retro salary rate evidence. This is NEVER a payroll adjustment.
 * No social contributions, tax, OT, night premium, loans or statutory amounts
 * are calculated from the difference between two base rate values.
 */
export type SalaryRateRevisionEvidence = {
  id: number;
  effectiveDate: string;
  previousPayBasis: string;
  previousRateAmount: string;
  newPayBasis: string;
  newRateAmount: string;
};

export type RateEvidenceKind = "revision_as_of_date" | "revision_prior_baseline" | "current_profile_unverified" | "incomplete_history";

export function validSalaryCorrectionDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function positiveSalaryRateCents(value: unknown): bigint {
  const raw = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(raw)) {
    throw new Error("Proposed rate must be a positive decimal with no more than two places.");
  }
  const [whole, fraction = ""] = raw.split(".");
  const cents = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0") || "0");
  if (cents <= BigInt(0) || cents > BigInt("10000000000")) {
    throw new Error("Proposed rate must be greater than 0 and at most 100000000.00.");
  }
  return cents;
}

function centsAsDecimal(cents: bigint): string {
  const abs = cents < BigInt(0) ? -cents : cents;
  return (cents < BigInt(0) ? "-" : "") + String(abs / BigInt(100)) + "." + String(abs % BigInt(100)).padStart(2, "0");
}

export function previewHistoricalSalaryRate(input: {
  effectiveDate: string;
  proposedPayBasis: string;
  proposedRateAmount: string | number;
  currentPayBasis: string;
  currentRateAmount: string | number;
  revisions: readonly SalaryRateRevisionEvidence[];
  historyCapped: boolean;
}) {
  if (!validSalaryCorrectionDate(input.effectiveDate)) throw new Error("Invalid date-only effective date.");
  const proposedBasis = input.proposedPayBasis.trim().toLowerCase();
  if (!["monthly", "daily", "hourly"].includes(proposedBasis)) throw new Error("Invalid proposed pay basis.");
  const proposedRate = positiveSalaryRateCents(input.proposedRateAmount);
  const sorted = [...input.revisions].sort(
    (a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.id - a.id,
  );
  const onDate = sorted.find((revision) => revision.effectiveDate <= input.effectiveDate);
  const earliest = sorted[sorted.length - 1] ?? null;
  const oldBasis = onDate?.newPayBasis ?? (input.historyCapped ? null : earliest?.previousPayBasis ?? input.currentPayBasis);
  const oldRate = onDate?.newRateAmount ?? (input.historyCapped ? null : earliest?.previousRateAmount ?? input.currentRateAmount);
  const evidence: RateEvidenceKind = onDate
    ? "revision_as_of_date"
    : input.historyCapped ? "incomplete_history"
      : earliest ? "revision_prior_baseline" : "current_profile_unverified";

  // We only expose a per-unit rate comparison for revision-backed evidence of
  // the SAME pay basis. This cannot be interpreted as wages or take-home pay.
  let rateDeltaPerBasisUnit: string | null = null;
  if ((evidence === "revision_as_of_date" || evidence === "revision_prior_baseline")
    && oldBasis === proposedBasis && oldRate !== null) {
    try {
      rateDeltaPerBasisUnit = centsAsDecimal(proposedRate - positiveSalaryRateCents(oldRate));
    } catch {
      // Broken source evidence is unknown rather than an invented pay figure.
      rateDeltaPerBasisUnit = null;
    }
  }
  return {
    effectiveDate: input.effectiveDate,
    before: oldBasis && oldRate !== null ? { payBasis: oldBasis, rateAmount: String(oldRate) } : null,
    proposed: { payBasis: proposedBasis, rateAmount: centsAsDecimal(proposedRate) },
    rateDeltaPerBasisUnit,
    evidence,
    // This contract intentionally cannot hold a payable amount.
    payrollAmountDelta: null,
    requiresIndependentPayrollRecalculation: true as const,
  };
}

/** Reject non-object JSON before the API reads any request properties. */
export function isSalaryCorrectionRequestObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Explicit response allowlist: keep raw rates inside the calculation boundary.
 * The permitted per-unit difference is still sensitive compensation evidence,
 * not anonymous data or a payable amount; the API's payroll/MFA gates remain.
 * Never spread source objects here: future salary, bank or note fields must not
 * become client-visible merely because they were added to an internal record.
 */
export function projectSalaryCorrectionEvidence(
  assessment: ReturnType<typeof previewHistoricalSalaryRate>,
  revisions: readonly SalaryRateRevisionEvidence[],
) {
  return {
    assessment: {
      effectiveDate: assessment.effectiveDate,
      before: assessment.before ? { payBasis: assessment.before.payBasis } : null,
      proposed: { payBasis: assessment.proposed.payBasis },
      rateDeltaPerBasisUnit: assessment.rateDeltaPerBasisUnit,
      evidence: assessment.evidence,
      payrollAmountDelta: null,
      requiresIndependentPayrollRecalculation: true as const,
    },
    recentRevisions: revisions.map((revision) => ({
      id: revision.id,
      effectiveDate: revision.effectiveDate,
      previousPayBasis: revision.previousPayBasis,
      newPayBasis: revision.newPayBasis,
    })),
  };
}
