/**
 * DL-01 payment-evidence method proof contract. Structural checks are guardrails;
 * passing this alone never certifies cross-employer isolation. The active
 * tenant-second-pass-http.mjs runs the real three-employer HTTP/PG cases in CI.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const src = readFileSync("scripts/qa/tenant-manifest-driven-http.mjs", "utf8");
const harness = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const targets = [
  "GET compliance/statutory-remittances/payment-evidence/[id]",
  "GET compliance/statutory-remittances/payment-evidence",
];
const routeIndex = new Map(Object.values(manifest.allApiRouteFiles).flatMap((route) =>
  route.methods.map((method) => [method.name + " " + route.route, method])));

test("victim-only evidence row exists after BOTH higher-order attacker targets, not an invented 404", () => {
  assert.ok(src.includes('{ orgIndex: 2, month: "2025-10" },\n    // Select the real victim-only target AFTER both attacker-owned objects.\n    { orgIndex: 0, month: "2025-11" }'));
  assert.ok(src.includes("const victimEvidence = fixtures.evidence[10]"));
  assert.ok(src.includes("const victimBatch = fixtures.batches[10]"));
  assert.ok(src.includes("const victimTask = fixtures.tasks[10]"));
  assert.ok(src.includes("victimEvidence.id > ownedEvidence.id && victimBatch.id > ownedBatch.id"));
  assert.ok(src.includes("victimTask.id > ownedTask.id"));
  assert.ok(src.includes("persistedVictimEvidence?.organizationId, victimOrg.id"));
  assert.ok(src.includes("persistedVictimBatch?.organizationId, victimOrg.id"));
  assert.ok(src.includes("ownedEvidence.organizationId, ownOrg.id"));
  assert.ok(src.includes("ownedEvidence.batchId, ownedBatch.id"));
});

test("each download/index method must exercise authenticated own success, exact victim denial and forged selector", () => {
  for (const key of targets) {
    assert.ok(routeIndex.has(key), "No invented route/method: " + key);
    assert.ok(src.includes('"' + key + '": {'), key + ": missing live URL adapter");
  }
  assert.ok(src.includes('const own = expectStatus(await request(urls.own, { cookie }), 200'));
  assert.ok(src.includes('const foreign = expectStatus(await request(urls.foreign, { cookie }), adapter.denial'));
  assert.ok(src.includes('assert.match(r.text, /^%PDF-/)'));
  assert.ok(src.includes('assert.equal(r.headers.get("x-payment-proof-sha256"), ownedEvidence.fileSha256)'));
  assert.ok(src.includes('const crossId = expectStatus(await request('));
  assert.ok(src.includes('"?organizationId=" + ownOrg.id, { cookie }), 404'));
  assert.ok(src.includes('const filtered = expectStatus(await request('));
  assert.ok(src.includes('"&batchId=" + victimBatch.id, { cookie }), 200'));
  assert.ok(src.includes("assert.deepEqual(filtered.json?.evidence, []"));
});

test("real PostgreSQL unchanged-victim snapshot and both independent attacker sessions remain mandatory", () => {
  assert.ok(src.includes("for (const idx of [1, 2])"));
  assert.ok(src.includes('assert.equal(account.json?.profile?.id, f.owners[idx].id)'));
  assert.ok(src.includes("const before = await snapshotVictim(victimOrg.id)"));
  assert.ok(src.includes("const after = await snapshotVictim(victimOrg.id)"));
  assert.ok(src.includes("assert.deepEqual(after, before"));
  assert.ok(src.includes("assert.equal(observations.length, FIRST_ADAPTED_METHODS.length * 2)"));
  assert.ok(harness.includes('verifyManifestDrivenStatutoryBatch(f, { request, expectStatus })'));
  assert.ok(src.includes('process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only"'));
});
