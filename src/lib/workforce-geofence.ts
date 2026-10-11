/**
 * Private, opt-in GPS boundary check for employee self-clock punches.
 * Never retain the raw employee GPS fix: the caller may audit only the
 * resulting worksite ID, coarse distance/accuracy bands and policy version.
 */
export const GEOFENCE_POLICY_VERSION = "wfm-geofence-v1";
export const GEOFENCE_MAX_FIX_AGE_MS = 60_000;
export const GEOFENCE_MAX_ACCURACY_METERS = 100;

export type GeofenceSite = {
  id: number;
  latitude: number;
  longitude: number;
  radiusMeters: number;
};

export type GeofenceDecision =
  | { ok: true; worksiteId: number; distanceBand: string; accuracyBand: string; policyVersion: string }
  | { ok: false; code: string; error: string };

export function geofencePilotEnabledForOrganization(
  organizationId: number,
  env: { WFM_GEOFENCE_PILOT_ENABLED?: string; WFM_GEOFENCE_PILOT_ORG_IDS?: string } = {
    WFM_GEOFENCE_PILOT_ENABLED: process.env.WFM_GEOFENCE_PILOT_ENABLED,
    WFM_GEOFENCE_PILOT_ORG_IDS: process.env.WFM_GEOFENCE_PILOT_ORG_IDS,
  },
): boolean {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0 || env.WFM_GEOFENCE_PILOT_ENABLED !== "true") {
    return false;
  }
  return (env.WFM_GEOFENCE_PILOT_ORG_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^[1-9]\d*$/.test(value))
    .some((value) => Number(value) === organizationId);
}

function validCoordinates(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}

export function validateGeofenceSite(value: unknown):
  | { ok: true; value: Omit<GeofenceSite, "id"> }
  | { ok: false; error: string } {
  if (!value || typeof value !== "object") return { ok: false, error: "Worksite GPS centre and radius are required." };
  const site = value as Record<string, unknown>;
  const { latitude, longitude, radiusMeters } = site;
  if (typeof latitude !== "number" || typeof longitude !== "number"
    || !validCoordinates(latitude, longitude)
    || typeof radiusMeters !== "number" || !Number.isInteger(radiusMeters)
    || radiusMeters < 100 || radiusMeters > 2000) {
    return { ok: false, error: "Enter finite latitude (-90 to 90), longitude (-180 to 180) and a boundary radius from 100 to 2000 metres." };
  }
  return { ok: true, value: { latitude, longitude, radiusMeters } };
}

/** Primary assignment plus explicitly allowed secondary sites; dated denials win. */
export function permittedGeofenceWorksiteIds(input: {
  date: string;
  assignments: Array<{ id: number; worksiteId: number; decision: string; effectiveFrom: string; effectiveUntil?: string | null }>;
  authorizations: Array<{ worksiteId: number; decision: string; effectiveFrom: string; effectiveUntil?: string | null }>;
}): number[] {
  const active = (row: { effectiveFrom: string; effectiveUntil?: string | null }) =>
    row.effectiveFrom <= input.date && (!row.effectiveUntil || row.effectiveUntil >= input.date);
  // Resolve the latest effective primary decision first. An explicit denial
  // must not cause us to fall back to a stale, earlier primary allow.
  const primary = input.assignments
    .filter(active)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.id - a.id)[0];
  const allowed = new Set<number>();
  if (primary?.decision === "allow") allowed.add(primary.worksiteId);
  for (const row of input.authorizations.filter(active)) {
    if (row.decision === "allow") allowed.add(row.worksiteId);
  }
  // Either an explicit primary-assignment denial or an HCM authorization
  // denial must override every active allow for the same worksite.
  const denied = new Set([
    ...input.assignments.filter((row) => active(row) && row.decision === "deny").map((row) => row.worksiteId),
    ...input.authorizations.filter((row) => active(row) && row.decision === "deny").map((row) => row.worksiteId),
  ]);
  return [...allowed].filter((id) => !denied.has(id));
}

function distanceInMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad)
    * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function distanceBand(meters: number): string {
  if (meters < 50) return "under-50m";
  if (meters < 100) return "50-99m";
  if (meters < 250) return "100-249m";
  if (meters < 500) return "250-499m";
  if (meters < 1000) return "500-999m";
  return "1000m-plus";
}
function accuracyBand(meters: number): string {
  return meters <= 25 ? "0-25m" : meters <= 50 ? "26-50m" : "51-100m";
}

/** Browser fixes are only evidence: they can be spoofed and do not verify identity. */
export function evaluateGeofenceFix(input: {
  fix: unknown;
  sites: GeofenceSite[];
  now?: number;
}): GeofenceDecision {
  if (input.sites.length === 0) {
    return { ok: false, code: "GEOFENCE_NO_AUTHORIZED_SITE", error: "No configured and authorized worksite is available. Ask HR to record an attendance exception." };
  }
  if (!input.fix || typeof input.fix !== "object") {
    return { ok: false, code: "GEOFENCE_LOCATION_REQUIRED", error: "Allow a one-time location check to clock in or out, or ask HR for a manual attendance review." };
  }
  const fix = input.fix as Record<string, unknown>;
  if (typeof fix.latitude !== "number" || typeof fix.longitude !== "number"
    || !validCoordinates(fix.latitude, fix.longitude)
    || typeof fix.accuracyMeters !== "number"
    || !Number.isFinite(fix.accuracyMeters) || fix.accuracyMeters < 0
    || typeof fix.capturedAt !== "string" || !/^\d{4}-\d\d-\d\dT/.test(fix.capturedAt)) {
    return { ok: false, code: "GEOFENCE_INVALID_FIX", error: "The browser supplied an invalid GPS fix. Try again or ask HR for an attendance review." };
  }
  const now = input.now ?? Date.now();
  const captured = Date.parse(fix.capturedAt);
  if (!Number.isFinite(captured) || now - captured > GEOFENCE_MAX_FIX_AGE_MS || captured - now > 5000) {
    return { ok: false, code: "GEOFENCE_FIX_STALE", error: "The GPS fix is stale. Retry with a fresh device location." };
  }
  if (fix.accuracyMeters > GEOFENCE_MAX_ACCURACY_METERS) {
    return { ok: false, code: "GEOFENCE_ACCURACY_LOW", error: "The GPS fix is not precise enough. Move near an open area or ask HR for an exception." };
  }
  const candidates = input.sites
    .filter((site) => validateGeofenceSite(site).ok && Number.isSafeInteger(site.id) && site.id > 0)
    .map((site) => ({ site, meters: distanceInMeters(fix.latitude as number, fix.longitude as number, site.latitude, site.longitude) }))
    .sort((a, b) => a.meters - b.meters);
  if (candidates.length === 0) {
    return { ok: false, code: "GEOFENCE_SITE_UNCONFIGURED", error: "The authorized worksite has no valid GPS boundary. Ask HR to configure it." };
  }
  // A nearer small boundary must not reject a worker located inside another
  // expressly authorized site's larger (overlapping) boundary.
  const permitted = candidates.find((candidate) => candidate.meters <= candidate.site.radiusMeters);
  if (!permitted) {
    return { ok: false, code: "GEOFENCE_OUTSIDE_WORKSITE", error: "This clock action is outside the approved worksite boundary. Request a reviewed attendance exception if needed." };
  }
  return {
    ok: true,
    worksiteId: permitted.site.id,
    distanceBand: distanceBand(permitted.meters),
    accuracyBand: accuracyBand(fix.accuracyMeters as number),
    policyVersion: GEOFENCE_POLICY_VERSION,
  };
}
