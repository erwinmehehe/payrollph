import test from "node:test";
import assert from "node:assert/strict";
import { assertClaimDenied, assertOwnEmployeeClaimList } from "../scripts/qa/tenant-offline-claims-contract.mjs";

function ownResponse(rows, overrides = {}) {
  const json = { organizationId: 11, claims: rows, ...(overrides.json ?? {}) };
  return {
    status: overrides.status ?? 200,
    json,
    text: JSON.stringify(json),
    headers: new Headers({ "cache-control": overrides.cache ?? "private,no-store" }),
  };
}
const owned = [{ id: 22, organizationId: 11, actionType: "clock_in", status: "pending_review" }];
const desired = { organizationId: 11, claimId: 22, forbiddenIds: [55, 77] };

test("valid persisted owned claim and private no-store pass", () => {
  assert.doesNotThrow(() => assertOwnEmployeeClaimList(ownResponse(owned), desired));
});
test("empty 200 response is never a positive tenant proof", () => {
  assert.throws(() => assertOwnEmployeeClaimList(ownResponse([]), desired), /persisted own claim/);
});
test("wrong-tenant response with otherwise valid own ID fails", () => {
  assert.throws(() => assertOwnEmployeeClaimList(ownResponse(owned,
    { json: { organizationId: 99 } }), desired), /current employer/);
});
test("foreign employer ID in an otherwise valid list fails", () => {
  assert.throws(() => assertOwnEmployeeClaimList(ownResponse([
    ...owned, { id: 55, organizationId: 99, actionType: "clock_out" },
  ]), desired), /foreign employer claim leaked/);
});
test("foreign claim with forged own organization fails ID exclusion", () => {
  assert.throws(() => assertOwnEmployeeClaimList(ownResponse([
    ...owned, { id: 77, organizationId: 11, actionType: "clock_out" },
  ]), desired), /foreign claim ID leaked/);
});
test("employee read must never disclose claimant or coworker identity fields", () => {
  assert.throws(() => assertOwnEmployeeClaimList(ownResponse([
    { ...owned[0], employeeId: 44, submittedByUserId: 88 },
  ]), desired), /reviewer-only/);
});
test("missing private no-store rejects even correct data", () => {
  assert.throws(() => assertOwnEmployeeClaimList(ownResponse(owned,
    { cache: "public,max-age=3600" }), desired), /noncacheable|shared or cached/);
});
test("denied foreign tenant response accepts 403 without disclosure", () => {
  const response = { status: 403, text: '{"error":"Forbidden."}', json: { error: "Forbidden." },
    headers: new Headers() };
  assert.doesNotThrow(() => assertClaimDenied(response, {
    status: 403, forbiddenMarker: "VICTIM-ONLY", forbiddenClaimId: 77,
  }));
});
test("foreign denial returning HTTP 200 fails", () => {
  const response = { status: 200, text: "{}", json: {}, headers: new Headers() };
  assert.throws(() => assertClaimDenied(response, {
    status: 403, forbiddenMarker: "VICTIM-ONLY", forbiddenClaimId: 77,
  }), /not refused/);
});
test("victim secret in foreign denial body fails", () => {
  const response = { status: 404, text: "VICTIM-ONLY", json: { error: "Not found" },
    headers: new Headers() };
  assert.throws(() => assertClaimDenied(response, {
    status: 404, forbiddenMarker: "VICTIM-ONLY", forbiddenClaimId: 77,
  }), /marker leaked/);
});
test("victim claim ID returned by denial fails", () => {
  const response = { status: 404, text: '{"claimId":77}', json: { claimId: 77 },
    headers: new Headers() };
  assert.throws(() => assertClaimDenied(response, {
    status: 404, forbiddenMarker: "VICTIM-ONLY", forbiddenClaimId: 77,
  }), /victim claim ID/);
});
