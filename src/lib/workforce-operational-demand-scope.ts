/**
 * A malformed access object must not become an implicit company-wide grant.
 * This complements the route's authenticated role check and employer-scoped SQL.
 */
export function operationalDemandSiteAuthorized(
  access: { organizationId: number; companyWide: boolean; orgUnitId: number | null } | null | undefined,
  worksite: { organizationId: number; orgUnitId: number | null; active: boolean } | null | undefined,
): boolean {
  if (!access || !worksite
    || !Number.isSafeInteger(access.organizationId)
    || access.organizationId <= 0
    || access.organizationId !== worksite.organizationId
    || worksite.active !== true
    || (worksite.orgUnitId !== null
      && (!Number.isSafeInteger(worksite.orgUnitId) || worksite.orgUnitId <= 0))) {
    return false;
  }
  // Company-wide means a real Boolean grant with NO assigned unit.
  if (access.companyWide === true) return access.orgUnitId === null;
  // Unit managers require an actual assigned, positive safe integer unit.
  if (access.companyWide !== false) return false;
  return Number.isSafeInteger(access.orgUnitId)
    && access.orgUnitId !== null
    && access.orgUnitId > 0
    && access.orgUnitId === worksite.orgUnitId;
}
