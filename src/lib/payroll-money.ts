/**
 * Financial rounding rule: store the same centavos that a payslip displays.
 * Round each payroll earnings bucket before summing, using integer centavos.
 * This avoids raw float fractions making gross disagree with printed buckets.
 */
export function roundedGrossFromBuckets(buckets: readonly number[]): number {
  let totalCentavos = 0;
  for (const amount of buckets) {
    if (!Number.isFinite(amount)) throw new Error("Non-finite payroll amount cannot be included in gross.");
    totalCentavos += Math.round((amount + Number.EPSILON) * 100);
  }
  return Math.max(0, totalCentavos) / 100;
}
