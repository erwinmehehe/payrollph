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
  "GET compliance/statutory-remittances/posting-evidence/[id]",
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
  assert.ok(src.includes('"&batchId=" + victimBatch.id, { cookie }), 404'));
  assert.ok(src.includes('assert.ok(!filtered.text.includes("SYNTHETIC-ONLY-0-"'));
});

test("real PostgreSQL unchanged-victim snapshot and both independent attacker sessions remain mandatory", () => {
  assert.ok(src.includes("for (const idx of [1, 2])"));
  assert.ok(src.includes('assert.equal(account.json?.profile?.id, f.owners[idx].id)'));
  assert.ok(src.includes("const before = await snapshotVictim(victimOrg.id)"));
  assert.ok(src.includes("const after = await snapshotVictim(victimOrg.id)"));
  assert.ok(src.includes("assert.deepEqual(after, before"));
  assert.ok(src.includes("assert.equal(observations.length, FIRST_ADAPTED_METHODS.length * 2)"));
  assert.ok(harness.includes('verifyManifestDrivenStatutoryBatch(f, { request, expectStatus, makeSession })'));
  assert.ok(src.includes('process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only"'));
});

test("any DL-01 evidence method promoted to COVERED must pin all four exercised proof lines", () => {
  const lines = src.split("\n");
  for (const [index, key] of targets.entries()) {
    const record = routeIndex.get(key);
    if (record.status === "GAP") {
      assert.equal(record.testedBy, null, key + ": pending real HTTP evidence is not certified");
      continue;
    }
    assert.equal(record.status, "COVERED");
    const proof = record.testedBy;
    assert.equal(proof?.file, "scripts/qa/tenant-manifest-driven-http.mjs");
    const lineOf = (field) => {
      const number = proof[field];
      assert.ok(Number.isInteger(number) && number > 0 && number <= lines.length,
        key + ": missing real line for " + field);
      return lines[number - 1];
    };
    assert.ok(lineOf("line").includes('"' + key + '": {'), key + ": adapter identifier absent");
    assert.ok(lineOf("ownPositiveLine").includes("const own = expectStatus(await request(urls.own"),
      key + ": actual positive request required");
    assert.ok(lineOf("foreignDenialLine").includes("const foreign = expectStatus(await request(urls.foreign"),
      key + ": actual victim denial request required");
    const forgedSelectors = ["const crossId = expectStatus(await request(",
      "const filtered = expectStatus(await request(", "const forged = expectStatus(await request("];
    assert.ok(lineOf("forgedSelectorLine").includes(forgedSelectors[index]),
      key + ": method-specific forged victim selector required");
    assert.ok(lineOf("unchangedDbLine").includes("assert.deepEqual(after, before"),
      key + ": victim DB snapshot must remain equal");
    assert.ok((proof.scope ?? "").includes("independent attacker employers"),
      key + ": both authentic attacker employers must be part of the same proof suite");
  }
});

test("posting-source download adapter uses real high-ID PostgreSQL CSV and unchanged victim snapshot", () => {
  assert.ok(src.includes('"GET compliance/statutory-remittances/posting-evidence/[id]": {'));
  assert.ok(src.includes('db.insert(statutoryPostingEvidenceArtifacts)'));
  assert.ok(src.includes('posting[10].id > posting[9].id'));
  assert.ok(src.includes('persistedVictimPosting?.organizationId, victimOrg.id'));
  assert.ok(src.includes('victimPosting.id > ownedPosting.id'));
  assert.ok(src.includes('assert.equal(sha256(Buffer.from(r.text, "utf8")), ownedPosting.contentSha256'));
  assert.ok(src.includes('assert.equal(forged.text, ownPostingBytes.toString("utf8"))'));
  assert.ok(src.includes('"?organizationId=" + victimOrg.id + "&batchId=" + victimBatch.id'));
  assert.ok(src.includes('"?organizationId=" + ownOrg.id, { cookie }), 403'));
  assert.ok(src.includes('db.select().from(statutoryPostingEvidenceArtifacts)'));
  assert.ok(src.includes('const after = await snapshotVictim(victimOrg.id)'));
  assert.ok(src.includes('assert.deepEqual(after, before'));
});
