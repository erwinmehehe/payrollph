import { DE_MINIMIS_2026, deMinimisStatutoryPeriodStart, type DeMinimisType } from "./ph-compliance";

/**
 * What a payroll-provider switch tells the engine about the de minimis ceilings and the shared PHP 90,000
 * 13th-month/other-benefits pool consumed BEFORE the engine's first cutoff.
 *
 * Imported rows carry the previous provider's de minimis totals by category (importer field
 * deMinimisBreakdown) and the 13th month already paid. Where a worker's every imported row in the tax year has a
 * readable breakdown of fixed-peso-ceiling categories, reported consumption can be included in the engine's
 * own cutoffs (one ceiling per category and statutory period across both sources). This is a VERIFIED LOWER
 * BOUND on the shared benefit pool, NOT proof of its total: imported rows have no separate field for all
 * bonuses/other pool benefits. Payroll with current pool benefits must still be HELD for that missing evidence.
 * Any row with invalid or incomplete category/amount evidence makes that worker's calculated prior amounts
 * unverifiable; never substitute zero or lift a release hold.
 */
export type ImportedBenefitRow = {
  employeeId: number;
  payDate: string;
  grossPay: number | string;
  thirteenthMonth: number | string | null;
  deMinimisBreakdown: unknown;
};

export type ImportedBenefitPrior = {
  /** De minimis paid by category inside the statutory period that contains the cutoff's pay date. */
  deMinimisPaid: Partial<Record<DeMinimisType, number>>;
  /** Verified minimum: imported de minimis excess + reported 13th month. Other pool benefits remain unknown. */
  benefitPool90k: number;
};

/** Reject missing, negative, non-finite, non-centavo or unparseable imported monetary evidence. */
function verifiedCentavos(raw: unknown): number | null {
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  if (typeof raw === "string" && !/^[0-9]+(?:\\.[0-9]{1,2})?$/.test(raw.trim())) return null;
  const amount = Number(raw);
  const cents = amount * 100;
  if (!Number.isFinite(amount) || amount < 0 ||
      !Number.isSafeInteger(Math.round(cents)) ||
      Math.abs(cents - Math.round(cents)) > 0.000001) return null;
  return Math.round(cents);
}
const centsForCeiling = (value: number) => Math.round(value * 100);
const pesos = (value: number) => value / 100;

export function importedBenefitPrior(rows: readonly ImportedBenefitRow[], cutoffPayDate: string) {
  const known = new Map<number, ImportedBenefitPrior>();
  const unverifiable = new Set<number>();
  const periodTotals = new Map<number, Map<string, number>>();
  const poolFromThirteenth = new Map<number, number>();
  const paidNow = new Map<number, Map<DeMinimisType, number>>();

  for (const row of rows) {
    const employeeId = row.employeeId;
    const gross = verifiedCentavos(row.grossPay);
    const thirteenth = verifiedCentavos(row.thirteenthMonth);
    if (gross === null || thirteenth === null || thirteenth > gross) {
      unverifiable.add(employeeId);
      continue;
    }
    if (thirteenth > 0) {
      poolFromThirteenth.set(employeeId, (poolFromThirteenth.get(employeeId) ?? 0) + thirteenth);
    }
    const breakdown = row.deMinimisBreakdown;
    if (breakdown === null || breakdown === undefined || typeof breakdown !== "object" || Array.isArray(breakdown)) {
      unverifiable.add(employeeId);
      continue;
    }
    let reportedDeMinimis = 0;
    for (const [key, raw] of Object.entries(breakdown as Record<string, unknown>)) {
      const amount = verifiedCentavos(raw);
      const rule = (DE_MINIMIS_2026 as Record<string, { ceiling?: number }>)[key];
      // Even a zero-valued unsupported category is invalid; never ignore it.
      if (amount === null || !rule || typeof rule.ceiling !== "number" || key === "monetizedVacationLeaveDays") {
        unverifiable.add(employeeId);
        continue;
      }
      reportedDeMinimis += amount;
      if (amount === 0) continue;
      const type = key as DeMinimisType;
      const periodKey = type + "|" + deMinimisStatutoryPeriodStart(type, row.payDate);
      const totals = periodTotals.get(employeeId) ?? new Map<string, number>();
      totals.set(periodKey, (totals.get(periodKey) ?? 0) + amount);
      periodTotals.set(employeeId, totals);
      if (row.payDate >= deMinimisStatutoryPeriodStart(type, cutoffPayDate)) {
        const now = paidNow.get(employeeId) ?? new Map<DeMinimisType, number>();
        now.set(type, (now.get(type) ?? 0) + amount);
        paidNow.set(employeeId, now);
      }
    }
    if (reportedDeMinimis > gross) unverifiable.add(employeeId);
  }
  const employeeIds = new Set<number>(rows.map((row) => row.employeeId));
  for (const employeeId of employeeIds) {
    if (unverifiable.has(employeeId)) continue;
    let excess = 0;
    for (const [periodKey, total] of periodTotals.get(employeeId) ?? []) {
      const ceiling = (DE_MINIMIS_2026 as Record<string, { ceiling?: number }>)[periodKey.split("|")[0]].ceiling as number;
      excess += Math.max(0, total - centsForCeiling(ceiling));
    }
    const deMinimisPaid: Partial<Record<DeMinimisType, number>> = {};
    for (const [type, total] of paidNow.get(employeeId) ?? []) deMinimisPaid[type] = pesos(total);
    known.set(employeeId, { deMinimisPaid, benefitPool90k: pesos(excess + (poolFromThirteenth.get(employeeId) ?? 0)) });
  }
  return { known, unverifiable };
}
