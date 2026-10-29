/**
 * Verify an internal workforce read scope before touching private employer
 * forecasting data. This complements, not replaces, session/role checks.
 */
export type WorkforceTenantScope = {
  organizationId: number;
  companyWide: boolean;
  orgUnitId: number | null;
};

export function coherentWorkforceTenantScope(
  access: WorkforceTenantScope | null | undefined,
  requestedOrganizationId: number,
): boolean {
  if (!access
    || !Number.isSafeInteger(requestedOrganizationId)
    || requestedOrganizationId <= 0
    || !Number.isSafeInteger(access.organizationId)
    || access.organizationId !== requestedOrganizationId) return false;
  if (access.companyWide === true) return access.orgUnitId === null;
  if (access.companyWide === false) {
    return Number.isSafeInteger(access.orgUnitId)
      && access.orgUnitId !== null && access.orgUnitId > 0;
  }
  return false;
}
