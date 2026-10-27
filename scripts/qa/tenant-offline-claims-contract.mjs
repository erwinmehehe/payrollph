/**
 * Pure fail-closed response contracts for uncredited offline attendance claims.
 * No database, environment, HTTP or production feature can be activated by this file.
 */
import assert from "node:assert/strict";

export function assertOwnEmployeeClaimList(response, { organizationId, claimId, forbiddenIds = [] }) {
  assert.equal(response.status, 200, "a genuine employee must read their own claims");
  assert.equal(response.json?.organizationId, organizationId, "GET must bind the current employer");
  assert.ok(Array.isArray(response.json?.claims), "GET must return real claims, not an empty substitute");
  assert.ok(response.json.claims.some(row => row.id === claimId),
    "a persisted own claim must be present; empty 200 is not evidence");
  for (const row of response.json.claims) {
    assert.equal(row.organizationId, organizationId, "a foreign employer claim leaked");
    assert.ok(!Object.hasOwn(row, "employeeId") && !Object.hasOwn(row, "submittedByUserId"),
      "employee GET must not expose reviewer-only employee/actor identifiers");
    assert.ok(!forbiddenIds.includes(row.id), "foreign claim ID leaked into employee GET");
  }
  assert.match(response.headers.get("cache-control") ?? "", /private\s*,\s*no-store/i,
    "private attendance claims must not be shared or cached");
}

export function assertClaimDenied(response, { status, forbiddenMarker, forbiddenClaimId }) {
  assert.equal(response.status, status, "foreign or forged claim request was not refused");
  assert.ok(!response.text.includes(forbiddenMarker),
    "victim's tenant-only marker leaked in denial body");
  assert.ok(![...response.headers].some(([key, value]) =>
    (key + ": " + value).includes(forbiddenMarker)), "victim marker leaked in denial headers");
  assert.notEqual(response.json?.claimId, forbiddenClaimId,
    "denied request must not return victim claim ID");
  assert.notEqual(response.json?.claim?.id, forbiddenClaimId,
    "denied request must not return victim claim");
}
