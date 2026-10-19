/**
 * Method-adapter integrity: any "covered" assertion must be based on a
 * current manifest method (GAP or previously covered regression) plus real own success,
 * exact denied status and identical victim DB snapshot. Actual HTTP is
 * exercised by the production-mode isolated PostgreSQL workflow.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const src = readFileSync("scripts/qa/tenant-manifest-driven-http.mjs", "utf8");
const harness = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
const specs = [...src.matchAll(/^\s+"(GET [^"]+)": \{$/gm)].map((x) => x[1]);

test("single table-driven test reads ALL 489 methods without claiming precovered GET as a new GAP", () => {
  assert.equal(manifest.metrics.methods, 489);
  assert.equal(manifest.metrics.gap, 440);
  assert.equal(manifest.sourceTraceCandidates.length, 34);
  assert.equal(manifest.scopedPages.length, 20);
  const registry = new Map(Object.entries(manifest.allApiRouteFiles).flatMap(([path, info]) =>
    info.methods.map((m) => [m.name + " " + info.route, { path, ...m }])));
  assert.equal(specs.length, 6);
  assert.equal(new Set(specs).size, specs.length);
  for (const spec of specs) {
    const method = registry.get(spec);
    assert.ok(method && ["GAP", "COVERED"].includes(method.status),
      spec + " must map to a real manifest method, never an invented case");
  }
  assert.equal(specs.filter((spec) => registry.get(spec).status === "GAP").length, 5);
  assert.match(src, /const gaps = methodGaps\(\);/);
  assert.match(src, /for \(const item of candidates\)/);
  assert.match(src, /if \(!adapter\) continue; \/\/ GAP remains open;/);
  assert.match(src, /unadaptedGapMethodsStillOpen: gaps.length - \(FIRST_ADAPTED_METHODS.length - alreadyCoveredCases.length\)/);
});

test("real-HTTP and disposable DB proof requirements cannot be weakened", () => {
  assert.match(harness, /await \(await import\("\.\/tenant-manifest-driven-http\.mjs"\)\)\.verifyManifestDrivenStatutoryBatch\(f, \{ request, expectStatus \}\)/);

  assert.match(src, /process\.env\.TENANT_SECOND_PASS_MODE, "isolated-ci-only"/);
  assert.match(src, /const own = expectStatus\(await request\(urls\.own, \{ cookie \}\), 200/);
  assert.match(src, /const foreign = expectStatus\(await request\(urls\.foreign, \{ cookie \}\), adapter\.denial/);
  assert.match(src, /assert\.deepEqual\(after, before,/);
  assert.match(src, /evidence\[7\]\.id > 6/);
  assert.match(src, /tasks\[7\]\.id > 6/);
  assert.match(src, /victimDatabaseUnchanged: true, productionTested: false, certified: false/);
  assert.match(src, /sha256\(bytes\[i\]\)/);
  assert.match(src, /assert\.equal\(account\.json\?\.profile\?\.id, f\.owners\[idx\]\.id\)/);
});
