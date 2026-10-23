import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const m = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const pageProbe = readFileSync("scripts/qa/tenant-scoped-page-probes.mjs", "utf8");
const harness = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
test("all 20 business-ID pages have a real-HTTP two-attacker navigation probe", () => {
  assert.equal(m.scopedPages.length, 20);
  const covered = m.scopedPages.filter((p) => p.status === "COVERED");
  assert.deepEqual(covered.map((p) => p.path),
    ["src/app/hcm/manager-decision-inbox/page.tsx"]);
  assert.equal(covered[0].testedBy?.file, "scripts/qa/hcm-manager-inbox-page-http.mjs");
  assert.equal(m.scopedPages.filter((p) => p.status === "GAP").length, 19);
  assert.match(harness, /await \(await import\("\.\/tenant-scoped-page-probes\.mjs"\)\)\.probeManifestBusinessPages\(f, \{ request, makeSession, expectStatus \}\);/);
  assert.match(pageProbe, /for \(const page of pages\)/);
  assert.match(pageProbe, /for \(const idx of \[1, 2\]\)/);
  assert.match(pageProbe, /const ownRes = await request\(pageUrl\(path, own\.id\), \{ cookie \}\)/);
  assert.match(pageProbe, /const foreignRes = await request\(pageUrl\(path, victim\.id\), \{ cookie \}\)/);
  assert.match(pageProbe, /assert\.equal\(observations\.length, 40\)/);
});
test("HTML recon never converts an enabled/disabled/redirect response to security certification", () => {
  assert.match(pageProbe, /notCertified: !authorizedPage200 \|\| !correctlyDenied/);
  assert.match(pageProbe, /outstandingPageOrActionGaps: pageGaps\.length, pageGapsReclassified: 0/);
  assert.match(pageProbe, /assert\.deepEqual\(await db\.select\(\)\.from\(employees\)/);
  assert.match(pageProbe, /assert\.deepEqual\(await db\.select\(\)\.from\(payrollRuns\)/);
  assert.match(pageProbe, /crossEmployerPIIMarkersObserved: 0/);
  assert.match(pageProbe, /requiresFeatureOnBrowserAndActionAcceptance: true/);
});
