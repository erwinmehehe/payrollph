/**
 * Canonical, explicit employer for sensitive payroll tax-review SSR pages.
 * Next searchParams can be an array for duplicated query keys; do not coerce
 * it via Number() or fall back to the account's first company membership.
 */
export function explicitPayrollReviewEmployerId(value: unknown): number | null {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}
