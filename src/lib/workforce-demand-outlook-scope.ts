/** Conservative standalone scope guard. The API also filters by exact organization ID. */
export function authorizedOutlookSite(
  access: { organizationId: number; companyWide: boolean; orgUnitId: number | null },
  site: { organizationId: number; orgUnitId: number | null; active: boolean },
) {
  return access.organizationId === site.organizationId
    && site.active
    && (access.companyWide || (
      access.orgUnitId != null && site.orgUnitId === access.orgUnitId
    ));
}
