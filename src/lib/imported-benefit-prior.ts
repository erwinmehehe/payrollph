import { DE_MINIMIS_2026, deMinimisStatutoryPeriodStart, type DeMinimisType } from "./ph-compliance";

/**
 * What a payroll-provider switch tells the engine about the de minimis ceilings and the shared PHP 90,000
 * 13th-month/other-benefits pool consumed BEFORE the engine's first cutoff.
 *
 * Imported rows carry the previous provider's de minimis totals by category (importer field
 * deMinimisBreakdown) and the 13th month already paid. Where a worker's every imported row in the tax year has a
 * readable breakdown of fixed-peso-ceiling categories, the consumption is known exactly and is counted in the engine's
 * own cutoffs (one ceiling per category and statutory period across both sources, exactly as year-end annualization
 * already treats the union). Any row whose breakdown is missing, unreadable, unknown or of a category whose ceiling
 * is not a peso amount makes the worker UNVERIFIABLE: nothing is assumed and the payroll entry keeps its review hold.
 */
export type ImportedBenefitRow = {
  employeeId: number;
  payDate: string;
  thirteenthMonth: number | string | null;
  deMinimisBreakdown: unknown;
};

export type ImportedBenefitPrior = {
  /** De minimis paid by category inside the statutory period that contains the cutoff's pay date. */
  deMinimisPaid: Partial<Record<DeMinimisType, number>>;
  /** Imported excess over the ceilings plus the 13th month already paid: it has used this much of the 90,000 pool. */
  benefitPool90k: number;
};

const centavos = (value: number) => Math.round((value + Number.EPSILON) * 100);
const pesos = (value: number) => value / 100;

export function importedBenefitPrior(rows: readonly ImportedBenefitRow[], cutoffPayDate: string) {
  const known = new Map<number, ImportedBenefitPrior>();
  const unverifiable = new Set<number>();
  const periodTotals = new Map<number, Map<string, number>>();
  const poolFromThirteenth = new Map<number, number>();
  const paidNow = new Map<number, Map<DeMinimisType, number>>();

  for (const row of rows) {
    const employeeId = row.employeeId;
    const thirteenth = Number(row.thirteenthMonth ?? 0);
    if (Number.isFinite(thirteenth) && thirteenth > 0) {
      poolFromThirteenth.set(employeeId, (poolFromThirteenth.get(employeeId) ?? 0) + centavos(thirteenth));
    }
    const breakdown = row.deMinimisBreakdown;
    if (breakdown === null || breakdown === undefined || typeof breakdown !== "object" || Array.isArray(breakdown)) {
      unverifiable.add(employeeId);
      continue;
    }
    for (const [key, raw] of Object.entries(breakdown as Record<string, unknown>)) {
      const amount = Number(raw);
      if (!Number.isFinite(amount) || amount < 0) { unverifiable.add(employeeId); continue; }
      if (amount === 0) continue;
      const rule = (DE_MINIMIS_2026 as Record<string, { ceiling?: number }>)[key];
      if (!rule || typeof rule.ceiling !== "number" || key === "monetizedVacationLeaveDays") {
        unverifiable.add(employeeId);
        continue;
      }
      const type = key as DeMinimisType;
      const periodKey = `${type}|${deMinimisStatutoryPeriodStart(type, row.payDate)}`;
      const totals = periodTotals.get(employeeId) ?? new Map<string, number>();
      totals.set(periodKey, (totals.get(periodKey) ?? 0) + centavos(amount));
      periodTotals.set(employeeId, totals);
      if (row.payDate >= deMinimisStatutoryPeriodStart(type, cutoffPayDate)) {
        const now = paidNow.get(employeeId) ?? new Map<DeMinimisType, number>();
        now.set(type, (now.get(type) ?? 0) + centavos(amount));
        paidNow.set(employeeId, now);
      }
    }
  }

  const employeeIds = new Set<number>(rows.map((row) => row.employeeId));
  for (const employeeId of employeeIds) {
    if (unverifiable.has(employeeId)) continue;
    let excess = 0;
    for (const [periodKey, total] of periodTotals.get(employeeId) ?? []) {
      const ceiling = (DE_MINIMIS_2026 as Record<string, { ceiling?: number }>)[periodKey.split("|")[0]].ceiling as number;
      excess += Math.max(0, total - centavos(ceiling));
    }
    const deMinimisPaid: Partial<Record<DeMinimisType, number>> = {};
    for (const [type, total] of paidNow.get(employeeId) ?? []) deMinimisPaid[type] = pesos(total);
    known.set(employeeId, { deMinimisPaid, benefitPool90k: pesos(excess + (poolFromThirteenth.get(employeeId) ?? 0)) });
  }
  return { known, unverifiable };
}
