/**
 * Filing and frozen-liability amounts are *already posted* decimal currency.
 * Reject any non-cent precision before converting to safe integer centavos;
 * never use an approximate equality tolerance for an accounting match.
 *
 * Canonical Number.toString() retains a two-decimal posted number such as 0.29
 * but exposes 0.30000000000000004 or 0.0000000005 as unposted precision.
 */
export function postedCentavos(value: number): number | null {
  if (!Number.isFinite(value) || !/^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value.toString())) {
    return null;
  }
  const cents = Math.round(value * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}
