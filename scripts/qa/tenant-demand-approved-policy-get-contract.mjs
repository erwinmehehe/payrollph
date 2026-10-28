import assert from "node:assert/strict";
import { assertDemandDenial, assertNonCacheableDemand } from "./tenant-demand-governance-recovery-contract.mjs";

export const APPROVED_POLICY_GET = "GET workforce/demand-staffing/policies";

// Assert a populated, *approved* SQL/event-backed response. The existing draft
// preview proof does not cover this branch of the real HTTP handler.
export function assertApprovedPolicyHttp(response, expected, forbiddenMarkers = []) {
  assert.equal(response?.status, 200, "own approved-policy GET must return HTTP 200");
  assertNonCacheableDemand(response.headers);
  const body = response.json;
  assert.equal(body?.readOnly, true);
  assert.deepEqual(Object.keys(body).sort(),
    ["readOnly", "scope", "policies", "boundary"].sort());
  assert.deepEqual(body.scope, {
    organizationId: expected.organizationId,
    worksiteId: expected.worksiteId,
    jobProfileId: expected.jobProfileId,
    metricKind: "transactions", intervalMinutes: 60,
  });
  assert.match(body.boundary, /No roster or payroll write/);
  assert.equal(body.policies?.length, 1,
    "one real, exact-scope, independently approved policy is required");
  const row = body.policies[0];
  assert.deepEqual(Object.keys(row).sort(), [
    "organizationId", "worksiteId", "jobProfileId", "metricKind",
    "intervalMinutes", "effectiveFrom", "effectiveUntil",
    "productiveUnitsPerWorkerHour", "serviceTargetCoveragePercent",
    "rationale", "id", "version", "status", "createdAt", "submittedAt",
    "approvedAt", "contentSha256", "approvalReceiptSha256", "approvalIntegrity",
  ].sort(), "HTTP must expose only the reviewed, bounded policy projection");
  for (const key of ["organizationId", "worksiteId", "jobProfileId",
    "id", "version", "contentSha256", "approvalReceiptSha256",
    "effectiveFrom", "effectiveUntil", "productiveUnitsPerWorkerHour",
    "serviceTargetCoveragePercent", "rationale"]) {
    assert.deepEqual(row[key], expected[key], key + " differs from the exact SQL source");
  }
  assert.equal(row.status, "approved", "a draft or disabled preview is not positive proof");
  assert.equal(row.approvalIntegrity, "matches_hash",
    "a policy without a valid independent approval receipt is not accepted");
  assert.match(row.contentSha256, /^[a-f0-9]{64}$/);
  assert.match(row.approvalReceiptSha256, /^[a-f0-9]{64}$/);
  assert.ok(Date.parse(row.createdAt) > 0);
  assert.ok(Date.parse(row.submittedAt) > 0);
  assert.ok(Date.parse(row.approvedAt) > 0);
  const serialized = response.text + "\n" +
    [...response.headers.entries()].map(([k,v]) => k + ":" + v).join("\n");
  for (const marker of forbiddenMarkers) {
    assert.ok(typeof marker === "string" && marker.length > 0);
    assert.ok(!serialized.includes(marker), "a different employer's source leaked");
  }
  return row;
}

export function assertApprovedPolicyDenial(response, status, forbiddenMarkers = []) {
  assertDemandDenial(response, status, forbiddenMarkers);
  assert.equal(response.json?.scope, undefined);
  assert.equal(response.json?.boundary, undefined);
  assert.equal(response.json?.readOnly, undefined);
}
