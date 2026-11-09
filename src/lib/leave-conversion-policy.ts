/**
 * A positive leave balance does not, by itself, authorize cash conversion.
 * Per-tenant/type conversion caps are a temporary fail-closed pilot release
 * policy while a fully versioned DBA-backed policy is designed.
 *
 * Configure by operator approval only, e.g.
 * LEAVE_CONVERSION_MAX_DAYS_JSON={"11":{"vacation leave":5,"service incentive leave":5}}
 * A zero or absent cap DISABLES conversion for that tenant/type.
 */
export function approvedLeaveConversionCap(
  organizationId: number,
  leaveType: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): number | null {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) return null;
  if (!env.LEAVE_CONVERSION_MAX_DAYS_JSON) return null;
  try {
    const parsed: unknown = JSON.parse(env.LEAVE_CONVERSION_MAX_DAYS_JSON);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const tenant: unknown = (parsed as Record<string, unknown>)[String(organizationId)];
    if (!tenant || typeof tenant !== "object" || Array.isArray(tenant)) return null;
    const type = leaveType.trim().toLowerCase();
    const value = (tenant as Record<string, unknown>)[type];
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    if (value <= 0 || value > 366 || Math.round(value * 10) !== value * 10) return null;
    return value;
  } catch {
    return null;
  }
}

export function leaveConversionAllowance(input: {
  available: number;
  reserved: number;
  alreadyConverted: number;
  policyAnnualDays: number;
  approvedAnnualConversionCap: number | null;
}): number {
  const { available, reserved, alreadyConverted, policyAnnualDays, approvedAnnualConversionCap } = input;
  if ([available, reserved, alreadyConverted, policyAnnualDays].some(v => !Number.isFinite(v))) return 0;
  if (approvedAnnualConversionCap == null || !Number.isFinite(approvedAnnualConversionCap)) return 0;
  // Existing reservations count against the annual authorization even if a
  // leave balance record has not yet been decremented by the payroll ledger.
  const dayTenths = Math.floor(
    Math.max(0, Math.min(
      available - reserved,
      policyAnnualDays - alreadyConverted,
      approvedAnnualConversionCap - alreadyConverted,
    )) * 10 + 1e-9,
  );
  return dayTenths / 10;
}

export function validateLeaveConversionDays(days: unknown): days is number {
  return typeof days === "number" && Number.isFinite(days)
    && days > 0 && days <= 366 && Math.round(days * 10) === days * 10;
}

/**
 * Separate tax-control release latch. An approved leave-day cap cannot attest
 * to correct Philippine withholding treatment. Operators may include an
 * organization only after the applicable classification has been reviewed.
 * This is configuration evidence, not a substitute for the signed review.
 */
export function leaveConversionTaxReviewAcknowledged(
  organizationId: number,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) return false;
  return (env.LEAVE_CONVERSION_TAX_REVIEWED_ORG_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^[1-9]\d*$/.test(id))
    .map(Number)
    .filter(Number.isSafeInteger)
    .includes(organizationId);
}

/** 2026 current-year private vacation-leave ceiling: 12 annual days from 2026-01-06
 * under BIR RR 29-2025. Earlier dates used 10 days. Final-pay review applies
 * the effective date via final-pay-tax-classification; this separate leave
 * conversion pilot only accepts the current Manila calendar year. */
export const LEAVE_CONVERSION_ANNUAL_EXEMPT_DAYS = 12;

export type LeaveConversionTaxPart = { daysConverted: number; cashAmount: number; taxExempt: boolean };

/**
 * Split one conversion into the part still inside this year's 12-day exemption and the taxable remainder. Days are tenths and
 * amounts are centavos throughout; the parts always add up exactly to the requested days and to days x daily rate.
 */
export function splitLeaveConversionExemption(input: { daysConverted: number; dailyRate: number; exemptDaysAlreadyUsed: number }): LeaveConversionTaxPart[] {
  const tenths = (value: number) => Math.round(value * 10);
  const requested = tenths(input.daysConverted);
  const used = Math.max(0, tenths(input.exemptDaysAlreadyUsed));
  const rateCents = Math.round(input.dailyRate * 100);
  if (!Number.isSafeInteger(requested) || requested <= 0 || !Number.isSafeInteger(rateCents) || rateCents <= 0) {
    throw new Error("LEAVE_CONVERSION_SPLIT_INVALID");
  }
  const exemptTenths = Math.max(0, Math.min(requested, LEAVE_CONVERSION_ANNUAL_EXEMPT_DAYS * 10 - used));
  const totalCents = Math.round((requested * rateCents) / 10);
  const exemptCents = Math.round((exemptTenths * rateCents) / 10);
  const parts: LeaveConversionTaxPart[] = [];
  if (exemptTenths > 0) parts.push({ daysConverted: exemptTenths / 10, cashAmount: exemptCents / 100, taxExempt: true });
  if (requested > exemptTenths) {
    parts.push({ daysConverted: (requested - exemptTenths) / 10, cashAmount: (totalCents - exemptCents) / 100, taxExempt: false });
  }
  return parts;
}
