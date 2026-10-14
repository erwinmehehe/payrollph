/**
 * Client-side comparison of the exact benefit enrollment an administrator reviewed.
 * This is NOT a consent artifact or an authorization check. The signed API remains
 * authoritative and employee consent must be evidenced separately before rollout.
 */
export type BenefitEnrollmentReviewInput = {
  organizationId: number;
  employeeId: number;
  planId: number;
  monthlyContribution: string | number;
  startedOn: string;
};

export function benefitEnrollmentReviewKey(input: BenefitEnrollmentReviewInput): string | null {
  if (![input.organizationId, input.employeeId, input.planId].every(
    (id) => Number.isSafeInteger(id) && id > 0,
  )) return null;
  const { startedOn } = input;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startedOn)) return null;
  const date = new Date(`${startedOn}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== startedOn) return null;
  const amount = String(input.monthlyContribution).trim();
  // PostgreSQL numeric(10,2) cannot hold a non-centavo or arbitrarily large amount.
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(amount)) return null;
  const cents = Math.round(Number(amount) * 100);
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > 9_999_999_999) return null;
  return JSON.stringify([input.organizationId, input.employeeId, input.planId, cents, startedOn]);
}

export function benefitEnrollmentReviewConfirmed(reviewedKey: string | null, currentKey: string | null): boolean {
  return currentKey !== null && reviewedKey === currentKey;
}
