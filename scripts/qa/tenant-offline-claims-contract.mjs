/**
 * Pure fail-closed response contracts for uncredited offline attendance claims.
 * No database, environment, HTTP or production feature can be activated by this file.
 */
import assert from "node:assert/strict";

/**
 * A compliant no-store response is safe even when Next.js normalizes the
 * header to "no-store, max-age=0" without a redundant "private" directive.
 * Reject missing no-store AND conflicting directives that invite storage.
 * This is shared by real GET and idempotent POST-replay HTTP proofs.
 */
export function assertClaimNoStore(headers) {
  const directives = (headers?.get("cache-control") ?? "").toLowerCase()
    .split(",").map((part) => part.trim()).filter(Boolean);
  assert.ok(directives.includes("no-store"),
    "sensitive attendance claims require Cache-Control: no-store");
  const allowed = new Set(["no-store", "private", "max-age=0", "no-cache", "must-revalidate"]);
  assert.ok(directives.every((part) => allowed.has(part)),
    "sensitive attendance claims must not be shared or cached");
}

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
  assertClaimNoStore(response.headers);
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
