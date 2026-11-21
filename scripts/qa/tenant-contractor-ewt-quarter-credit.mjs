#!/usr/bin/env node
/**
 * Bounded, fail-closed credit contract for exactly one new EWT GET method.
 * Does not mark any old GAP or other route covered; independent approval is absent.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const path = "src/app/api/contractors/ewt-quarter/route.ts";
const proofPath = "scripts/qa/tenant-contractor-ewt-quarter-http.mjs";
const manifestPath = "scripts/qa/tenant-isolation-coverage-manifest.json";
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const blob = file => execFileSync("git", ["hash-object", file], { encoding: "utf8" }).trim();
const row = manifest.allApiRouteFiles[path];
assert.ok(row, "The new GET must appear in the canonical manifest in this PR");
assert.equal(row.route, "contractors/ewt-quarter");
assert.equal(row.gitBlobSha, blob(path), "Cannot credit a different EWT handler");
assert.deepEqual(row.methods.map(m => m.name), ["GET"]);
const method = row.methods[0];
assert.equal(method.status, "COVERED");
assert.match(method.reason, /SOLO_VERIFIED_DEV_RECOVERY/);
assert.match(method.reason, /independent.*PENDING/i);
assert.equal(method.testedBy.file, proofPath);
assert.equal(method.testedBy.routeBlobSha, blob(path));
assert.equal(method.testedBy.proofBlobSha, blob(proofPath));
assert.equal(method.testedBy.evidenceLabel, "SOLO_VERIFIED_DEV_RECOVERY");
assert.equal(method.testedBy.postgresMajor, 16);
assert.equal(method.testedBy.independentSecurityReview, "PENDING");
assert.equal(method.testedBy.independentlyAccepted, false);
assert.equal(method.testedBy.productionCertified, false);
assert.equal(method.testedBy.productionTested, false);
const code = readFileSync(path, "utf8").split("\n");
const proof = readFileSync(proofPath, "utf8").split("\n");
assert.match(code[method.line - 1], /export async function GET\(/);
for (const [key, token] of Object.entries({
  ownPositiveLine: "const ownReport = status(",
  foreignDenialLine: "const foreign = status(",
  forgedSelectorLine: "status(await request(ownURL + \"&contractorId=\" + v.id",
  unchangedDbLine: "assert.deepEqual(await snapshot(victim.id), beforeVictim",
  victimExistsLine: "const v = await newContractor(victim",
  victimIdOrderingLine: "assert.ok(v.id > 6",
})) {
  const num = method.testedBy[key];
  assert.ok(Number.isInteger(num) && num > 0, "Missing real proof anchor " + key);
  assert.ok(proof[num - 1]?.includes(token), key + " proof citation does not point to assertion");
}
assert.match(proof.join("\n"), /EWT-QUARTER PG16 PASS/);
assert.match(proof.join("\n"), /assertIsolated\(\)/);
assert.match(readFileSync("tests/contractor-ewt-quarter-api-contract.test.mjs", "utf8"), /mutation caught:/);
const tally = (m) => {
  const rows = Object.values(m.allApiRouteFiles);
  const methods = rows.flatMap(r => r.methods);
  const count = name => methods.filter(x => x.status === name).length;
  return { routeFiles: rows.length, methods: methods.length, covered: count("COVERED"),
    gap: count("GAP"), public: count("PUBLIC-BY-DESIGN"),
    tokenOnly: count("PRIVILEGED-OPERATIONS-TOKEN-ONLY") };
};
const after = tally(manifest);
assert.equal(manifest.metrics.routeFiles, after.routeFiles);
assert.equal(manifest.metrics.methods, after.methods);
assert.equal(manifest.metrics.coveredAfter, after.covered);
assert.equal(manifest.metrics.gap, after.gap);
assert.equal(manifest.metrics.publicByDesign, after.public);
assert.equal(manifest.metrics.privilegedOperationsTokenOnly, after.tokenOnly);
assert.deepEqual(after, { routeFiles: 296, methods: 499, covered: 455, gap: 7, public: 25, tokenOnly: 12 });
let before = null;
try {
  const baseRef = process.env.EWT_BASE_REF || "origin/main";
  const base = JSON.parse(execFileSync("git", ["show", baseRef + ":" + manifestPath], { encoding: "utf8", maxBuffer: 64 << 20 }));
  before = tally(base);
  assert.deepEqual(before, { routeFiles: 295, methods: 498, covered: 454, gap: 7, public: 25, tokenOnly: 12 });
  assert.equal(base.allApiRouteFiles[path], undefined, "New endpoint must not duplicate an old credit");
  for (const [key, value] of Object.entries(base.allApiRouteFiles)) {
    assert.deepEqual(manifest.allApiRouteFiles[key], value, "Unrelated route credit changed: " + key);
  }
} catch (error) {
  if (process.env.GITHUB_ACTIONS === "true") throw error;
  console.warn("Base manifest not accessible locally; CI must verify existing credits unchanged.");
}
console.log("EWT_QUARTER_CREDIT_RECONCILED " + JSON.stringify({
  before, after, label: "SOLO_VERIFIED_DEV_RECOVERY",
  independentSecurityReview: "PENDING", filingReady: false,
}));
