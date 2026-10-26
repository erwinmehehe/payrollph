import { assertLiveTenantCounts } from "./helpers/tenant-counts.mjs";
/**
 * Source integrity only: final acceptance also requires exact-head real HTTP
 * and disposable PostgreSQL 16 Security HTTP Smoke, plus human security review.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const proofFile = "scripts/qa/tenant-pii01-identifier-review-http.mjs";
const proof = readFileSync(proofFile, "utf8");
const lines = proof.split("\n");
const runner = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const path = "src/app/api/employee-identifier-requests/route.ts";
const specs = {
  GET: { own: 140, foreign: 151, forged: 157 },
  POST: { own: 167, foreign: 176, forged: 181, ignored: 186 },
};

test("PII-01 source evidence is executed only in real isolated localhost PG16", () => {
  assert.match(runner,
    /verifyPiiIdentifierReviewIsolation\(f, \{ request, expectStatus \}\)/);
  assert.match(proof, /process\.env\.CI, "true"/);
  assert.match(proof, /process\.env\.TENANT_SECOND_PASS_MODE, "isolated-ci-only"/);
  assert.match(proof, /pg\.pathname, "\/app_db"/);
  assert.match(proof, /process\.env\.DEMO_MODE, "false"/);
  assert.match(proof, /governmentIdEncryptionConfigured\(\), true/);
  assert.match(proof, /!process\.env\.PAYMONGO_SECRET_KEY && !process\.env\.XENDIT_SECRET_KEY/);
  assert.match(proof, /for \(const a of own\)/);
  assert.match(proof, /const own = \[1, 2\]\.map/);
  assert.match(proof, /victimRequest\.id > Math\.max\(6, \.\.\.own\.flatMap/);
  assert.match(proof, /assert\.deepEqual\(await victimSnapshot\(victim\.id\), baseline/);
  assert.match(proof, /requestedByUserId: f\.owners\[0\]\.id/);
  assert.match(proof, /const sealedValues = victimRows\.map/);
});

test("GET and POST are distinct review-only tenant proofs with exact source pins", () => {
  const methods = manifest.allApiRouteFiles[path]?.methods ?? [];
  assert.deepEqual(methods.map(m => m.name), ["GET", "POST"]);
  for (const [verb, spec] of Object.entries(specs)) {
    const entry = methods.find(m => m.name === verb);
    assert.equal(entry.status, "COVERED", verb + " must retain only provisional method credit");
    assert.equal(entry.testedBy?.file, proofFile);
    assert.equal(entry.testedBy?.ownPositiveLine, spec.own);
    assert.equal(entry.testedBy?.foreignDenialLine, spec.foreign);
    assert.equal(entry.testedBy?.forgedSelectorLine, spec.forged);
    assert.equal(entry.testedBy?.victimExistsLine, 123);
    assert.equal(entry.testedBy?.victimIdOrderingLine, 117);
    assert.equal(entry.testedBy?.unchangedDbLine, 196);
    assert.match(lines[spec.own - 1] ?? "", /expectStatus\(await request\(/);
    assert.match(lines[spec.foreign - 1] ?? "", /expectStatus\(await request\(/);
    assert.match(lines[spec.forged - 1] ?? "", /expectStatus\(await request\(/);
    const positive = lines.slice(spec.own - 1, spec.own + 3).join("\n");
    assert.match(positive, /\)\s*,\s*200\s*,/);
    const denied = lines.slice(spec.foreign - 1, spec.foreign + 3).join("\n");
    assert.match(denied, /\)\s*,\s*403\s*,/);
    if (verb === "POST") {
      assert.match(lines[spec.ignored - 1] ?? "", /expectStatus\(await request\(/);
      assert.match(lines.slice(spec.forged - 1, spec.forged + 3).join("\n"),
        /\)\s*,\s*404\s*,/);
      assert.match(positive, /method: "POST"/);
      assert.match(denied, /method: "POST"/);
      assert.match(lines.slice(spec.ignored - 1, spec.ignored + 4).join("\n"),
        /employeeId: f\.victimEmployee\.id/);
    }
  }
  assert.match(lines[122], /persistedVictimRequest\[0\]\?\.employeeId, f\.victimEmployee\.id/);
  assert.match(lines[195], /assert\.deepEqual\(await victimSnapshot\(victim\.id\), baseline/);
  // Page/action coverage is independently checked by the full-surface inventory test.
  // Do not pin unrelated page GAP counts in a PII-01 method evidence test.
});

test("synced method inventory retains live counts and base coverage", () => { assertLiveTenantCounts(assert, manifest); });

test("synced method inventory retains live counts and base coverage", () => { assertLiveTenantCounts(assert, manifest); });
