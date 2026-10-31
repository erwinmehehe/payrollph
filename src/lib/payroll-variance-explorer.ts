import type { PayrollVarianceCategory } from "./payroll-variance";
import type { VerifiedVarianceRow } from "./payroll-checker-variance-read";

export type PayrollVarianceMateriality = "all" | "at_least_100" | "at_least_1000" | "no_prior";
export type PayrollVarianceSort = "source" | "largest_net_change" | "employee";

/**
 * A read-only lens over already authorized, validated checker rows.
 * Never synthesize a missing prior pay, recompute payroll, or change approvals.
 */
export function selectPayrollVarianceRows(
  rows: readonly VerifiedVarianceRow[],
  category: PayrollVarianceCategory | "all",
  materiality: PayrollVarianceMateriality,
  sort: PayrollVarianceSort,
): VerifiedVarianceRow[] {
  const filtered = rows.filter((row) => {
    if (category !== "all" && !row.categories.includes(category)) return false;
    if (materiality === "no_prior") return row.netDelta === null;
    if (materiality === "all") return true;
    if (row.netDelta === null || !Number.isFinite(row.netDelta)) return false;
    const cents = Math.round(Math.abs(row.netDelta) * 100);
    return cents >= (materiality === "at_least_100" ? 10000 : 100000);
  });
  if (sort === "source") return filtered;
  return filtered.map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const difference = sort === "largest_net_change"
        ? ((b.row.netDelta === null ? -1 : Math.abs(b.row.netDelta)) -
           (a.row.netDelta === null ? -1 : Math.abs(a.row.netDelta)))
        : a.row.employeeName.localeCompare(b.row.employeeName, "en-PH", { sensitivity: "base" });
      return difference || a.index - b.index;
    })
    .map(({ row }) => row);
}