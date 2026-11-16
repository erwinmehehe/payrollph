/**
 * A filing or frozen liability should already be a posted two-decimal amount.
 * Require whole centavos before comparing; a one-cent difference is never a
 * match. The tiny tolerance only absorbs IEEE-754 multiplication noise, not
 * fractional-cent input or an accounting variance.
 */
export function postedCentavos(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const scaled = value * 100;
  const cents = Math.round(scaled);
  if (!Number.isSafeInteger(cents) || Math.abs(scaled - cents) > 1e-7) {
    return null;
  }
  return cents;
}
