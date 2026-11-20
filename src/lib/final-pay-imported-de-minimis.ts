import { DE_MINIMIS_2026, type DeMinimisType } from "./ph-compliance";
import { importedDeMinimisTreatment } from "./year-end";

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * A worker whose earlier months were imported from a previous provider carries that provider's de minimis totals by category
 * (the deMinimisBreakdown of each imported row). Year end applies the statutory ceiling once per category and period to the UNION of
 * the imported months and the engine's own DM- lines: the part inside the ceiling is exempt, the part above joins the shared 90,000
 * pool. Final pay must do the same, otherwise the imported de minimis pay (which is inside the imported gross pay) is taxed in full.
 *
 * Returns what to ADD to the exempt and excess totals the final-pay derivation already read from the released payslips. The delta
 * replaces the engine's separately capped figures for the same categories, exactly as year-end annualization does. Rows with an
 * unreadable, unknown or uncappable breakdown are refused (importedDeMinimisTreatment throws), never guessed.
 */
export function importedDeMinimisFinalPayAdjustment(
  historical: ReadonlyArray<{ id: number; payDate: unknown; grossPay: unknown; deMinimisBreakdown: unknown }>,
  released: ReadonlyArray<{ payDate: unknown; lineItems: unknown }>,
): { exempt: number; excess: number } {
  const rows = historical.map((row) => ({
    id: row.id,
    payDate: String(row.payDate),
    grossPay: row.grossPay as number | string,
    deMinimisBreakdown: row.deMinimisBreakdown,
  }));
  const imported = importedDeMinimisTreatment(rows);
  // Without any imported de minimis there is nothing to share a ceiling with; the engine's own accounting stands.
  if (!(imported.exempt + imported.excess > 0)) return { exempt: 0, excess: 0 };

  const engineLines: Array<{ category: DeMinimisType; payDate: string; amount: number }> = [];
  let engineExempt = 0;
  let engineExcess = 0;
  for (const entry of released) {
    if (!Array.isArray(entry.lineItems)) continue;
    const payDate = String(entry.payDate);
    for (const item of entry.lineItems as Array<{ code?: unknown; amount?: unknown; periodOtherBenefitsPool?: unknown }>) {
      const code = String(item?.code ?? "");
      if (!code.startsWith("DM-")) continue;
      const category = code.slice(3);
      const rule = (DE_MINIMIS_2026 as Record<string, { ceiling?: number }>)[category];
      // Meal allowance (a daily, wage-order based ceiling) and leave days stay exactly as the engine accounted them.
      if (!rule || typeof rule.ceiling !== "number" || category === "monetizedVacationLeaveDays") continue;
      const amount = Math.max(0, Number(item.amount ?? 0));
      const pool = Math.max(0, Number(item.periodOtherBenefitsPool ?? 0));
      engineExempt += Math.max(0, amount - pool);
      engineExcess += pool;
      engineLines.push({ category: category as DeMinimisType, payDate, amount });
    }
  }
  const union = importedDeMinimisTreatment(rows, engineLines);
  return { exempt: round2(union.exempt - round2(engineExempt)), excess: round2(union.excess - round2(engineExcess)) };
}
