import { coherentWorkforceTenantScope } from "@/lib/workforce-tenant-scope";

/** Conservative standalone scope guard. The API also filters by exact organization ID. */
export function authorizedOutlookSite(
  access: { organizationId: number; companyWide: boolean; orgUnitId: number | null },
  site: { organizationId: number; orgUnitId: number | null; active: boolean },
) {
  return coherentWorkforceTenantScope(access, site.organizationId)
    && site.active === true
    && (access.companyWide || (
      site.orgUnitId !== null
      && Number.isSafeInteger(site.orgUnitId)
      && site.orgUnitId > 0
      && site.orgUnitId === access.orgUnitId
    ));
}
