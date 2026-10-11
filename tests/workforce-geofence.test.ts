import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateGeofenceFix, geofencePilotEnabledForOrganization, permittedGeofenceWorksiteIds,
  validateGeofenceSite, GEOFENCE_POLICY_VERSION,
} from "../src/lib/workforce-geofence";

const now = Date.parse("2026-10-11T10:00:00.000Z");
const site = { id: 1, latitude: 14.5995, longitude: 120.9842, radiusMeters: 200 };
const fix = { latitude: 14.5995, longitude: 120.9842, accuracyMeters: 30, capturedAt: "2026-10-11T09:59:45.000Z" };

test("geofence is default-off and requires explicit exact employer allowlist", () => {
  assert.equal(geofencePilotEnabledForOrganization(1, {}), false);
  assert.equal(geofencePilotEnabledForOrganization(1, { WFM_GEOFENCE_PILOT_ENABLED: "true" }), false);
  const env = { WFM_GEOFENCE_PILOT_ENABLED: "true", WFM_GEOFENCE_PILOT_ORG_IDS: "11, 17" };
  assert.equal(geofencePilotEnabledForOrganization(1, env), false);
  assert.equal(geofencePilotEnabledForOrganization(11, env), true);
  assert.equal(geofencePilotEnabledForOrganization(17, env), true);
  assert.equal(geofencePilotEnabledForOrganization(0, env), false);
});

test("GPS boundaries reject impossible and invalid locations", () => {
  for (const candidate of [
    { latitude: 91, longitude: 0, radiusMeters: 100 },
    { latitude: 0, longitude: 181, radiusMeters: 100 },
    { latitude: NaN, longitude: 1, radiusMeters: 200 },
    { latitude: 1, longitude: 1, radiusMeters: 99 },
    { latitude: 1, longitude: 1, radiusMeters: 2001 },
  ]) assert.equal(validateGeofenceSite(candidate).ok, false);
  assert.equal(validateGeofenceSite(site).ok, true);
});

test("only effective approved worksite IDs are available; dated denial wins", () => {
  const result = permittedGeofenceWorksiteIds({
    date: "2026-10-11",
    assignments: [
      { id: 1, worksiteId: 1, decision: "allow", effectiveFrom: "2026-01-01" },
      { id: 2, worksiteId: 2, decision: "allow", effectiveFrom: "2026-10-01" },
    ],
    authorizations: [
      { worksiteId: 3, decision: "allow", effectiveFrom: "2026-10-01" },
      { worksiteId: 2, decision: "deny", effectiveFrom: "2026-10-09" },
      { worksiteId: 4, decision: "allow", effectiveFrom: "2026-11-01" },
    ],
  });
  assert.deepEqual(result, [3]);
});

test("fresh, sufficiently accurate self-clock near the allowed site passes without retaining raw coordinates", () => {
  const result = evaluateGeofenceFix({ fix, sites: [site], now });
  assert.deepEqual(result, { ok: true, worksiteId: 1, distanceBand: "under-50m", accuracyBand: "26-50m", policyVersion: GEOFENCE_POLICY_VERSION });
  assert.equal("latitude" in result, false);
  assert.equal("longitude" in result, false);
});

test("unconfigured sites, missing/stale/inaccurate fixes and far-away punches fail closed", () => {
  assert.equal(evaluateGeofenceFix({ fix, sites: [], now }).ok, false);
  assert.equal(evaluateGeofenceFix({ fix: null, sites: [site], now }).ok, false);
  assert.equal(evaluateGeofenceFix({ fix: { ...fix, capturedAt: "2026-10-11T09:58:00.000Z" }, sites: [site], now }).ok, false);
  assert.equal(evaluateGeofenceFix({ fix: { ...fix, capturedAt: "2026-10-11T10:10:00.000Z" }, sites: [site], now }).ok, false);
  assert.equal(evaluateGeofenceFix({ fix: { ...fix, accuracyMeters: 200 }, sites: [site], now }).ok, false);
  assert.equal(evaluateGeofenceFix({ fix: { ...fix, latitude: 15.0 }, sites: [site], now }).ok, false);
  assert.equal(evaluateGeofenceFix({ fix, sites: [{ ...site, radiusMeters: 0 }], now }).ok, false);
});

test("a worker inside an authorized overlapping boundary is not rejected by a nearer, smaller one", () => {
  const position = { ...fix, latitude: 14.6006 };
  const decision = evaluateGeofenceFix({
    fix: position,
    sites: [{ ...site, radiusMeters: 100 }, { id: 2, latitude: 14.6033, longitude: 120.9842, radiusMeters: 500 }],
    now,
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.ok && decision.worksiteId, 2);
});

test("a newer denied primary assignment cannot reactivate a stale allowed primary site", () => {
  const result = permittedGeofenceWorksiteIds({
    date: "2026-10-11",
    assignments: [
      { id: 1, worksiteId: 1, decision: "allow", effectiveFrom: "2026-01-01" },
      { id: 2, worksiteId: 2, decision: "deny", effectiveFrom: "2026-10-01" },
    ],
    authorizations: [],
  });
  assert.deepEqual(result, []);
});

test("explicit primary denial overrides an older allow and same-site HCM authorization", () => {
  const result = permittedGeofenceWorksiteIds({
    date: "2026-10-11",
    assignments: [
      { id: 10, worksiteId: 1, decision: "allow", effectiveFrom: "2026-01-01" },
      { id: 11, worksiteId: 1, decision: "deny", effectiveFrom: "2026-10-01" },
    ],
    authorizations: [{ worksiteId: 1, decision: "allow", effectiveFrom: "2026-10-03" }],
  });
  assert.deepEqual(result, []);
});
