/**
 * Validate money sourced from persisted NUMERIC(precision, 2) fields or
 * immutable financial snapshots without JavaScript truthy/falsy coercion.
 *
 * Missing/blank/null/boolean values must NEVER become an apparent PHP 0.00
 * when validating whether a final-pay package can be released.
 */
export function storedMoneyCentavos(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "string" && !/^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) {
    return null;
  }
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(amount - cents / 100) > 1e-8) return null;
  return cents;
}
