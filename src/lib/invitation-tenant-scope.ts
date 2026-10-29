/**
 * Invitation privileges are scoped to the inviter's ACTIVE employer grant
 * (resolved through getAccess / assertOrganizationRole in the route).
 * A unit administrator may invite employees to that same unit only.
 * A company-wide owner is the sole role allowed to invite another owner.
 */
export type InvitationInviterScope = {
  role: string;
  companyWide: boolean;
  orgUnitId: number | null;
} | null | undefined;

/** Reject coerced, negative, ambiguous and oversized PostgreSQL unit IDs. */
export function parseInvitationUnitId(value: unknown): number | null {
  const number = typeof value === "number" ? value :
    typeof value === "string" && /^[1-9]\d*$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number > 0 && number <= 2147483647
    ? number : null;
}

/**
 * null: company-wide read; positive ID: only that unit; undefined: deny.
 * Never let an absent/malformed unit grant silently mean company-wide.
 */
export function invitationVisibleUnit(access: InvitationInviterScope): number | null | undefined {
  if (!access) return undefined;
  if (access.companyWide) return access.orgUnitId === null ? null : undefined;
  return parseInvitationUnitId(access.orgUnitId) ?? undefined;
}

export function canCreateScopedInvitation(
  access: InvitationInviterScope,
  role: string,
  targetOrgUnitId: number | null,
): boolean {
  const visibleUnit = invitationVisibleUnit(access);
  if (visibleUnit === undefined) return false;
  if (role === "owner") return visibleUnit === null && access?.role === "owner";
  if (visibleUnit === null) return true;
  // A unit admin cannot create a company-wide account or delegate a role
  // that can affect payroll, membership administration or another unit.
  return role === "employee" && targetOrgUnitId === visibleUnit;
}
