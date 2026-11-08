/**
 * Fail-closed Philippine final-pay vacation-leave tax-year checks.
 *
 * A leave-conversion row's createdAt is NOT its tax recognition date.
 * Only an organization-owned, Released payroll run with a dated payDate is
 * accepted as a prior exemption-year source; unresolved legacy entries block
 * automatic de minimis allocation pending accounting reconciliation.
 */
type PriorLeaveConversion = {
  id: number; status: string; taxExempt: boolean;
  daysConverted: string | number; payrollRunId: number | null;
};
type VerifiedPayrollRun = {
  id: number; organizationId: number; status: string; payDate: string;
};
function isoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(value + "T00:00:00Z").getTime())
    && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
}

export function priorExemptLeaveDaysInTaxYear(input: {
  organizationId: number; taxDate: string;
  conversions: PriorLeaveConversion[]; payrollRuns: VerifiedPayrollRun[];
}): number {
  if (!isoDate(input.taxDate) || !Number.isSafeInteger(input.organizationId)) {
    throw new Error("FINAL_PAY_LEAVE_TAX_HISTORY_UNVERIFIED: missing verified tax-year context.");
  }
  const runs = new Map(input.payrollRuns.map(row => [row.id, row]));
  let days = 0;
  for (const row of input.conversions) {
    if (row.status === "rejected" || !row.taxExempt) continue;
    const run = row.payrollRunId == null ? null : runs.get(row.payrollRunId);
    if (!Number.isSafeInteger(row.payrollRunId) || row.payrollRunId! <= 0
      || !run || run.organizationId !== input.organizationId
      || run.status !== "Released" || !isoDate(run.payDate)) {
      throw new Error("FINAL_PAY_LEAVE_TAX_HISTORY_UNVERIFIED: historical exempt leave conversion #" +
        row.id + " has no verified Released payroll pay date. Reconcile the annual ledger before claiming an exemption.");
    }
    const converted = Number(row.daysConverted);
    if (!Number.isFinite(converted) || converted <= 0
      || Math.abs(converted * 10 - Math.round(converted * 10)) > 1e-6) {
      throw new Error("FINAL_PAY_LEAVE_TAX_HISTORY_UNVERIFIED: invalid prior leave days.");
    }
    if (run.payDate.slice(0, 4) === input.taxDate.slice(0, 4)) days += converted;
  }
  return Math.round(days * 10) / 10;
}

/** Manual release is only an attestation, never bank settlement verification. */
export function leaveTaxReleaseDateNeedsReconciliation(
  classification: unknown, actualPayoutDate: unknown, asOfDate: string,
): boolean {
  if (!classification || typeof classification !== "object" || Array.isArray(classification)) return false;
  const record = classification as Record<string, unknown>;
  if (record.leaveTaxBasis !== "private_vacation_de_minimis") return false;
  // A mismatch (including December -> January) requires a new reviewed annual
  // tax computation and independent approval, not reuse of the old exemption.
  return !isoDate(record.taxDate) || !isoDate(actualPayoutDate)
    || !isoDate(asOfDate) || actualPayoutDate !== record.taxDate
    || actualPayoutDate > asOfDate;
}
