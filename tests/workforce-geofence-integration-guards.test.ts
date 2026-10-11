import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const bundy = read("src/app/api/web-bundy/route.ts");
const sites = read("src/app/api/workforce/worksites/route.ts");
const server = read("src/lib/workforce-geofence-server.ts");
const ui = read("src/components/web-bundy-modal.tsx");
const schema = read("src/db/schema.ts");

test("enforced GPS only on an allowlisted employee self-clock, after tenant and lock gates", () => {
  assert.ok(bundy.includes("geofencePilotEnabledForOrganization(organizationId)"));
  assert.ok(bundy.includes('user.role !== "employee"'));
  assert.ok(bundy.includes("enforceSameOriginMutation(request)"));
  assert.ok(bundy.includes("assertMembership(user.id, organizationId)"));
  assert.ok(bundy.includes("eq(employees.organizationId, organizationId)"));
  assert.ok(bundy.includes("attendanceMutationLock("));
  assert.ok(bundy.includes('actionType === "clock_in" || actionType === "clock_out"'));
  assert.ok(bundy.includes("authorizedGeofenceSites(organizationId, employeeId, todayStr)"));
  assert.ok(bundy.includes("if (!decision.ok)"));
  assert.ok(bundy.includes("GEOFENCE_SELF_CLOCK_ONLY"));
  assert.ok(bundy.includes('action: "geofenced-web-bundy"'));
  assert.ok(bundy.includes('action: "Web Bundy GPS verification rejected"'));
  assert.ok(bundy.includes("code: decision.code"));
});

test("GPS fix is not copied to DB, response or audit: only coarse site verification", () => {
  assert.ok(bundy.includes('location = `Verified worksite #${decision.worksiteId}`'));
  assert.ok(bundy.includes("accuracyBand: decision.accuracyBand"));
  assert.ok(bundy.includes("distanceBand: decision.distanceBand"));
  assert.ok(!bundy.includes("metadata: { geolocation:"));
  assert.ok(!bundy.includes("geolocation: body.geolocation"));
  assert.ok(!bundy.includes("JSON.stringify(body.geolocation)"));
  assert.ok(ui.includes("requestOneTimePosition()"));
  assert.ok(ui.includes("maximumAge: 0"));
  assert.ok(ui.includes('actionType === "clock_in" || actionType === "clock_out"'));
});

test("worksite geofence can only be configured by company-wide managers behind existing MFA/rate", () => {
  assert.ok(sites.includes('action === "configure_geofence"'));
  assert.ok(sites.includes("access.companyWide"));
  assert.ok(sites.includes("requireSensitiveActionMfa(user)"));
  assert.ok(sites.includes("enforceSensitiveActionRateLimit(request"));
  assert.ok(sites.includes("validateGeofenceSite(body)"));
  assert.ok(sites.includes("geofencePilotEnabledForOrganization(organizationId)"));
  assert.ok(schema.includes('geofenceLatitude: numeric("geofence_latitude"'));
  assert.ok(schema.includes('geofenceRadiusM: integer("geofence_radius_m")'));
});

test("effective dated tenant-bound worksite and HCM authorizations govern eligibility", () => {
  assert.ok(server.includes("eq(employeeWorksiteAssignments.organizationId, organizationId)"));
  assert.ok(server.includes("eq(hcmWorksiteAuthorizations.organizationId, organizationId)"));
  assert.ok(server.includes("eq(worksites.organizationId, organizationId)"));
  assert.ok(server.includes("permittedGeofenceWorksiteIds"));
  assert.ok(server.includes("eq(worksites.active, true)"));
});

test("a delayed one-time GPS prompt cannot mutate attendance after the clock closes", () => {
  assert.ok(ui.includes("if (!mounted.current) return;"));
  const promptEnd = ui.indexOf("geolocation = await requestOneTimePosition()");
  const unmountGuard = ui.indexOf("if (!mounted.current) return;", promptEnd);
  const mutation = ui.indexOf('fetch("/api/web-bundy", {', promptEnd);
  assert.ok(promptEnd > 0 && unmountGuard > promptEnd && mutation > unmountGuard);
});
