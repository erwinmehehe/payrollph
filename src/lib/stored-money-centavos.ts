/**
 * Validate money sourced from persisted NUMERIC(precision, 2) fields or
 * immutable financial snapshots without JavaScript truthy/falsy coercion.
 *
 * Missing/blank/null/boolean values must NEVER become an apparent PHP 0.00
 * when validating whether a final-pay package can be released.
 *
 * Decimal strings must be parsed to integer centavos BEFORE any Number
 * conversion. Financial review consumers still present numeric pesos, so
 * amounts that cannot round-trip to that presentation fail closed.
 */
export function verifiedPesosFromCentavos(cents: number): number | null {
  if (!Number.isSafeInteger(cents)) return null;
  const pesos = cents / 100;
  return Math.round(pesos * 100) === cents ? pesos : null;
}

export function storedMoneyCentavos(value: unknown): number | null {
  if (typeof value === "string") {
    const match = /^(-?)(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value);
    if (!match) return null;
    const whole = Number(match[2]);
    if (!Number.isSafeInteger(whole)) return null;
    const fraction = Number((match[3] ?? "").padEnd(2, "0"));
    const magnitude = whole * 100 + fraction;
    if (!Number.isSafeInteger(magnitude)) return null;
    const cents = match[1] === "-" ? -magnitude : magnitude;
    return verifiedPesosFromCentavos(cents) === null ? null : cents;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  // A source Number whose resolution approaches 0.1 centavo cannot prove
  // which decimal was originally recorded. Require a decimal string instead.
  if (Math.abs(value) * Number.EPSILON >= 0.001) return null;
  const cents = Math.round(value * 100);
  if (verifiedPesosFromCentavos(cents) === null) return null;
  // Tolerate ordinary binary noise (0.1 + 0.2), never arbitrary sub-centavo
  // evidence that an absolute 1e-8 tolerance could conceal as PHP zero.
  const tolerance = 2 * Number.EPSILON * Math.max(1, Math.abs(value));
  return Math.abs(value - cents / 100) <= tolerance ? cents : null;
}
