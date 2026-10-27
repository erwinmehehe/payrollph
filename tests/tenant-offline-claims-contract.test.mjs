import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { assertClaimDenied, assertOwnEmployeeClaimList, assertClaimNoStore } from "../scripts/qa/tenant-offline-claims-contract.mjs";

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
test("real Next.js no-store headers remain acceptable without an explicit private token", () => {
  for (const value of [
    "private,no-store", "private, no-store", "no-store, max-age=0",
    "No-Store, MAX-AGE=0", "no-store", "max-age=0, no-store, private",
    "no-store, no-cache, must-revalidate",
  ]) {
    const response = ownResponse(owned, { cache: value });
    assert.doesNotThrow(() => assertOwnEmployeeClaimList(response, desired), value);
    assert.doesNotThrow(() => assertClaimNoStore(response.headers), value);
  }
});

test("missing no-store or contradictory cache directives must fail closed", () => {
  for (const value of [
    "private", "no-cache", "public, max-age=0", "no-stored",
    "public, no-store", "no-store, public", "no-store, max-age=120",
    "no-store, s-maxage=0", "no-store, immutable",
    "no-store, stale-while-revalidate=0", "no-store, stale-if-error=0",
  ]) {
    assert.throws(() => assertClaimNoStore(ownResponse(owned, { cache: value }).headers),
      /no-store|shared or cached/i, value);
  }
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
test("cacheable response missing no-store rejects even correct owned data", () => {
  assert.throws(() => assertOwnEmployeeClaimList(ownResponse(owned,
    { cache: "public,max-age=3600" }), desired), /require Cache-Control: no-store/);
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

test("isolated offline-claim proof runs after shared receipts without modifying the source-pinned helper", () => {
  const workflow = readFileSync(".github/workflows/tenant-table-proof.yml", "utf8");
  const read = workflow.indexOf("run: npx tsx scripts/qa/tenant-table-http.mjs");
  const write = workflow.indexOf("run: npx tsx scripts/qa/tenant-write-table-http.mjs");
  const standalone = workflow.indexOf("run: npx tsx scripts/qa/tenant-offline-claims-standalone.mjs");
  assert.ok(read >= 0 && write > read && standalone > write,
    "real GET, shared write, and separate offline-claim write proofs must run in that order");
  assert.match(workflow, /if: matrix\.profile == 'flagged-reads'\n        run: npx tsx scripts\/qa\/tenant-offline-claims-standalone\.mjs/);
  const source = readFileSync("scripts/qa/tenant-offline-claims-standalone.mjs", "utf8");
  for (const required of [
    'GITHUB_ACTIONS: "true"', 'FACE_OFFLINE_PUNCH_UI_ENABLED: "true"',
    'createOfflineClaimReadRows({ assert, db })',
    'seedEmployer("VICTIM", nonce, standaloneMakeSession)',
    "await verifyOfflineClaimsTenantWrites([victim, attackerA, attackerB]",
  ]) {
    assert.ok(source.includes(required), "missing isolated source/evidence guard: " + required);
  }
  const receipt = JSON.parse(readFileSync("docs/qa/tenant-legal-employer-admin-receipt.json", "utf8"));
  const path = "scripts/qa/tenant-table-http.mjs";
  const pin = receipt.sources.find(item => item.file === path);
  assert.ok(pin && pin.sha256, "shared read helper must remain part of the receipt");
  const content = readFileSync(path, "utf8").replaceAll("\r\n", "\n");
  assert.equal(createHash("sha256").update(content).digest("hex"), pin.sha256,
    "offline-claim proof must not invalidate independent legal-entity HTTP evidence");
});
