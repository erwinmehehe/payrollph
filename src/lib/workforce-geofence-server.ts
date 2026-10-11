import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { employeeWorksiteAssignments, hcmWorksiteAuthorizations, worksites } from "@/db/schema";
import {
  permittedGeofenceWorksiteIds, validateGeofenceSite, type GeofenceSite,
} from "@/lib/workforce-geofence";

/**
 * Fetch only this legal employer's effective assignments and explicitly
 * authorized secondary locations. A current HCM denial overrides both.
 * This does not create a new employee location-history store.
 */
export async function authorizedGeofenceSites(
  organizationId: number, employeeId: number, workDate: string,
): Promise<GeofenceSite[]> {
  const [assignments, authorizations, siteRows] = await Promise.all([
    db.select().from(employeeWorksiteAssignments).where(and(
      eq(employeeWorksiteAssignments.organizationId, organizationId),
      eq(employeeWorksiteAssignments.employeeId, employeeId),
      lte(employeeWorksiteAssignments.effectiveFrom, workDate),
      or(isNull(employeeWorksiteAssignments.effectiveUntil), gte(employeeWorksiteAssignments.effectiveUntil, workDate)),
    )),
    db.select().from(hcmWorksiteAuthorizations).where(and(
      eq(hcmWorksiteAuthorizations.organizationId, organizationId),
      eq(hcmWorksiteAuthorizations.employeeId, employeeId),
      lte(hcmWorksiteAuthorizations.effectiveFrom, workDate),
      or(isNull(hcmWorksiteAuthorizations.effectiveUntil), gte(hcmWorksiteAuthorizations.effectiveUntil, workDate)),
    )),
    db.select({
      id: worksites.id,
      latitude: worksites.geofenceLatitude,
      longitude: worksites.geofenceLongitude,
      radiusMeters: worksites.geofenceRadiusM,
    }).from(worksites).where(and(
      eq(worksites.organizationId, organizationId),
      eq(worksites.active, true),
    )),
  ]);
  const permitted = new Set(permittedGeofenceWorksiteIds({
    date: workDate,
    assignments,
    authorizations,
  }));
  return siteRows
    .filter((site) => permitted.has(site.id))
    .flatMap((site) => {
      if (site.latitude === null || site.longitude === null || site.radiusMeters === null) return [];
      const candidate = {
        id: site.id,
        latitude: Number(site.latitude),
        longitude: Number(site.longitude),
        radiusMeters: site.radiusMeters,
      };
      return validateGeofenceSite(candidate).ok ? [candidate] : [];
    });
}
