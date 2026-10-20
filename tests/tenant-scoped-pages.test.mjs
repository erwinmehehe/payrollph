import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const m = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const pageProbe = readFileSync("scripts/qa/tenant-scoped-page-probes.mjs", "utf8");
const harness = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
test("all 20 business-ID pages have a real-HTTP two-attacker navigation probe", () => {
  assert.equal(m.scopedPages.length, 20);
  assert.ok(m.scopedPages.every((p) => p.status === "GAP"));
  assert.match(harness, /await \(await import\("\.\/tenant-scoped-page-probes\.mjs"\)\)\.probeManifestBusinessPages\(f, \{ request, makeSession, expectStatus \}\);/);
  assert.match(pageProbe, /for \(const page of pages\)/);
  assert.match(pageProbe, /for \(const idx of \[1, 2\]\)/);
  assert.match(pageProbe, /const ownRes = await request\(pageUrl\(path, own\.id\), \{ cookie \}\)/);
  assert.match(pageProbe, /const foreignRes = await request\(pageUrl\(path, victim\.id\), \{ cookie \}\)/);
  assert.match(pageProbe, /assert\.equal\(observations\.length, 40\)/);
});
test("HTML recon never converts an enabled/disabled/redirect response to security certification", () => {
  assert.match(pageProbe, /notCertified: !authorizedPage200 \|\| !correctlyDenied/);
  assert.match(pageProbe, /outstandingPageOrActionGaps: pages\.length, pageGapsReclassified: 0/);
  assert.match(pageProbe, /assert\.deepEqual\(await db\.select\(\)\.from\(employees\)/);
  assert.match(pageProbe, /assert\.deepEqual\(await db\.select\(\)\.from\(payrollRuns\)/);
  assert.match(pageProbe, /crossEmployerPIIMarkersObserved: 0/);
  assert.match(pageProbe, /requiresFeatureOnBrowserAndActionAcceptance: true/);
});
