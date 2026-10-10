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
