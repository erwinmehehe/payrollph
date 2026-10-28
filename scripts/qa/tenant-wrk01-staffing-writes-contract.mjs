/**
 * WRK-01: test-only tenant evidence for staffing-policy POST and PATCH.
 * No live provider calls, schedule updates, payroll writes, or method credits.
 */
import assert from "node:assert/strict";
import {
  requireDisposableDemandRecovery, assertDemandDenial, assertNonCacheableDemand,
} from "./tenant-demand-governance-recovery-contract.mjs";

export const STAFFING_WRITE_METHODS = Object.freeze([
  "POST workforce/demand-staffing/policies",
  "PATCH workforce/demand-staffing/policies",
]);
export const STAFFING_ENDPOINT = "/api/workforce/demand-staffing/policies";

export function requireDisposableStaffingWrites(env = process.env) {
  requireDisposableDemandRecovery(env);
  assert.equal(env.TRUSTED_APP_ORIGINS, "http://127.0.0.1:3000",
    "STAFFING_WRITES_REFUSED: loopback-only mutation origin required");
  assert.equal(env.GITHUB_ACTIONS, "true");
  assert.equal(env.REQUIRE_PRIVILEGED_MFA, "true");
  assert.equal(env.WFM_DEMAND_STAFFING_POLICIES_ENABLED, "true");
  assert.equal(env.WFM_ISSUED_DEMAND_FORECASTS_ENABLED, "true");
  // All pilot flags must refer to the same three bootstrap-owned companies.
  // Merely checking "three comma-separated numbers" permits a silent victim
  // omission or unrelated employer to reach a live policy mutation.
  const allowlistKeys = [
    "WFM_OPERATIONAL_DEMAND_ALLOWED_ORGANIZATION_IDS",
    "WFM_ISSUED_DEMAND_FORECASTS_ALLOWED_ORGANIZATION_IDS",
    "WFM_DEMAND_STAFFING_POLICIES_ALLOWED_ORGANIZATION_IDS",
  ];
  const expected = env[allowlistKeys[0]] ?? "";
  assert.match(expected, /^[1-9][0-9]{0,9},[1-9][0-9]{0,9},[1-9][0-9]{0,9}$/,
    "STAFFING_WRITES_REFUSED: three exact fictional employer IDs required");
  const ids = expected.split(",").map(Number);
  assert.ok(ids.every(id => Number.isSafeInteger(id) && id <= 2147483647) &&
    new Set(ids).size === 3 && ids[2] > ids[0] && ids[2] > ids[1],
    "STAFFING_WRITES_REFUSED: distinct higher-ID victim employer required");
  for (const name of allowlistKeys) {
    assert.equal(env[name], expected,
      "STAFFING_WRITES_REFUSED: inconsistent demand/issued/staffing allowlists: " + name);
  }
  for (const name of ["RESEND_WEBHOOK_SECRET", "PAYMONGO_WEBHOOK_SECRET",
    "XENDIT_CALLBACK_TOKEN_LIVE", "XENDIT_BILLING_API_KEY"]) {
    assert.ok(!env[name], "STAFFING_WRITES_REFUSED: no live provider secret " + name);
  }
}

function combinedResponse(response) {
  assert.ok(response && typeof response.text === "string");
  assert.ok(response.headers && typeof response.headers.get === "function");
  return response.text + "\n" +
    [...response.headers].map(([name, value]) => name + ":" + value).join("\n");
}

export function assertNoForeignPolicy(response, markers = []) {
  const content = combinedResponse(response);
  for (const marker of markers) {
    assert.ok(typeof marker === "string" && marker.length > 0);
    assert.ok(!content.includes(marker), "foreign employer data in headers or response body");
  }
}

export function assertStaffingDenied(response, status, markers = []) {
  assertDemandDenial(response, status, markers);
  assert.equal(response.json?.id, undefined,
    "denied write must never expose a policy ID");
  assert.equal(response.json?.contentSha256, undefined,
    "denied write must never return a private source hash");
  assert.equal(response.json?.approvalReceiptSha256, undefined,
    "denied write must never disclose an approval receipt");
  assertNoForeignPolicy(response, markers);
}

export function assertStaffingWrite(response, persisted, {
  status, policyStatus, kind, replayed = false, actorId, foreignMarkers = [],
}) {
  assert.equal(response.status, status,
    kind + ": expected persisted success; got " + response.status +
    " " + response.text.slice(0, 180));
  assertNonCacheableDemand(response.headers);
  assert.equal(response.json?.id, persisted.id,
    "HTTP success must identify the exact persisted own-employer row");
  assert.equal(response.json?.status, policyStatus);
  assert.equal(response.json?.contentSha256, persisted.contentSha256);
  assert.match(persisted.contentSha256, /^[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(persisted.id) && persisted.id > 0);
  assert.ok(Number.isSafeInteger(persisted.organizationId) && persisted.organizationId > 0);
  if (kind === "POST") {
    assert.equal(response.json.readOnlyProposal, true);
    assert.equal(response.json.replayed, replayed);
    assert.equal(response.json.version, persisted.version);
    assert.equal(persisted.proposedByUserId, actorId);
    assert.match(response.json.boundary, /does not approve staffing rules, shifts or payroll/);
  } else {
    assert.match(response.json.boundary, /never schedules or payroll/);
    if (policyStatus === "approved") {
      assert.equal(persisted.decidedByUserId, actorId);
      assert.match(response.json.approvalReceiptSha256, /^[a-f0-9]{64}$/);
    } else if (policyStatus === "rejected") {
      assert.equal(persisted.decidedByUserId, actorId);
      assert.equal(response.json.approvalReceiptSha256, null);
    }
  }
  assertNoForeignPolicy(response, foreignMarkers);
}

export function assertImmutableStaffingSql(before, after, label) {
  assert.deepEqual(after, before,
    label + ": foreign employer policies, events, audit, workers and payroll changed");
}
