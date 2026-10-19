/**
 * Deterministic PUBLIC, FICTIONAL demo payroll samples only (#1102).
 * Not statutory calculation, real payroll input, reconciliation or disbursement.
 * New demo run headers MUST be derived from these same six detail amounts.
 */
const BASE_GROSS_PESOS = [38_500, 29_200, 32_500, 24_500, 21_800, 34_800] as const;
const BASE_DEDUCTION_PESOS = [7_200, 5_400, 6_100, 4_600, 4_100, 6_500] as const;

export const PUBLIC_DEMO_PAYROLL_WORKERS = 6;

export function fictionalPublicDemoPayroll(runIndex: number) {
  if (!Number.isInteger(runIndex) || runIndex < 0 || runIndex > 2) {
    throw new Error("Only the three fixed fictional public-demo periods may be generated.");
  }
  const entries = BASE_GROSS_PESOS.map((baseGross, index) => {
    const gross = baseGross + runIndex * 250;
    const deductions = BASE_DEDUCTION_PESOS[index] + runIndex * 50;
    // Guard future edits to illustrative inputs before a new demo run is persisted.
    if (!Number.isSafeInteger(gross) || !Number.isSafeInteger(deductions) ||
        gross < 0 || deductions < 0 || deductions > gross) {
      throw new Error("Fictional demo payroll rows must contain valid nonnegative integer-peso amounts.");
    }
    return { gross, deductions, net: gross - deductions };
  });
  if (entries.length !== PUBLIC_DEMO_PAYROLL_WORKERS || BASE_DEDUCTION_PESOS.length !== entries.length) {
    throw new Error("The fictional demo fixture must contain exactly six detail rows.");
  }
  return {
    entries,
    // All test amounts are integer pesos. Store headers as exact centavo strings.
    grossPay: entries.reduce((sum, row) => sum + row.gross, 0).toFixed(2),
    netPay: entries.reduce((sum, row) => sum + row.net, 0).toFixed(2),
  };
}
