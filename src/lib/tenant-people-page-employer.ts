/**
 * Canonical, positive employer selector for the People SSR entry points.
 *
 * Next.js searchParams can contain arrays for duplicated query keys. Never
 * coerce those (or exponent/decimal/whitespace variants) to a different
 * employer ID before running the active membership and role checks.
 * The page may use its authenticated primary-employer fallback only when the
 * parameter is genuinely absent, not when it is present but malformed.
 */
export function canonicalPeoplePageOrganizationId(value: unknown): number | null {
  if (typeof value !== "string" || value !== value.trim() || !/^[1-9][0-9]*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}
