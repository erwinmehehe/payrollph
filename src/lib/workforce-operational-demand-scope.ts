/** No fallback from a branch manager to an unassigned or external site. */
export function operationalDemandSiteAuthorized(
  access: { organizationId: number; companyWide: boolean; orgUnitId: number | null },
  worksite: { organizationId: number; orgUnitId: number | null; active: boolean },
) {
  return access.organizationId === worksite.organizationId &&
    worksite.active && (
      access.companyWide || (
        access.orgUnitId != null && access.orgUnitId === worksite.orgUnitId
      )
    );
}
