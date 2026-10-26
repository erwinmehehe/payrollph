import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const m = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const pageProbe = readFileSync("scripts/qa/tenant-scoped-page-probes.mjs", "utf8");
const harness = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
test("all 21 business-ID pages have a real-HTTP two-attacker navigation probe", () => {
  assert.equal(m.scopedPages.length, 21);
  const covered = m.scopedPages.filter((p) => p.status === "COVERED");
  assert.deepEqual(covered.map((p) => p.path),
    ["src/app/app/page.tsx", "src/app/hcm/command-center/page.tsx",
      "src/app/hcm/manager-decision-inbox/page.tsx",
      "src/app/hcm/manager-direct-reports/page.tsx"]);
  assert.equal(covered[1].testedBy?.file, "scripts/qa/hcm-people-home-page-http.mjs");
  assert.equal(covered[2].testedBy?.file, "scripts/qa/hcm-manager-inbox-page-http.mjs");
  assert.equal(covered[0].testedBy?.file, "scripts/qa/tenant-scoped-page-probes.mjs");
  assert.equal(covered[3].testedBy?.file, "scripts/qa/hcm-manager-direct-reports-http.mjs");
  assert.match(harness, /verifyHcmManagerDirectReports\(f, \{ makeSession \}\)/);
  assert.match(pageProbe, /expectStatus\(ownRes, 200,/);
  assert.match(pageProbe, /ownRes\.text\.includes\(f\.ownedEmployees\[idx - 1\]\.employeeNo\)/);
  assert.match(pageProbe, /expectStatus\(foreignRes, 404,/);
  assert.match(pageProbe, /!ownRes\.text\.includes\("Workspace unavailable"\)/);
  assert.equal(m.scopedPages.filter((p) => p.status === "GAP").length, 17);
  assert.match(harness, /await \(await import\("\.\/tenant-scoped-page-probes\.mjs"\)\)\.probeManifestBusinessPages\(f, \{ request, makeSession, expectStatus \}\);/);
  assert.match(pageProbe, /for \(const page of pages\)/);
  assert.match(pageProbe, /for \(const idx of \[1, 2\]\)/);
  assert.match(pageProbe, /const ownRes = await request\(pageUrl\(path, own\.id\), \{ cookie \}\)/);
  assert.match(pageProbe, /const foreignRes = await request\(pageUrl\(path, victim\.id\), \{ cookie \}\)/);
  assert.match(pageProbe, /assert\.equal\(observations\.length, 42\)/);
});
test("HTML recon never converts an enabled/disabled/redirect response to security certification", () => {
  assert.match(pageProbe, /notCertified: !authorizedPage200 \|\| !correctlyDenied/);
  assert.match(pageProbe, /outstandingPageOrActionGaps: pageGaps\.length, pageGapsReclassified: 0/);
  assert.match(pageProbe, /assert\.deepEqual\(await db\.select\(\)\.from\(employees\)/);
  assert.match(pageProbe, /assert\.deepEqual\(await db\.select\(\)\.from\(payrollRuns\)/);
  assert.match(pageProbe, /crossEmployerPIIMarkersObserved: 0/);
  assert.match(pageProbe, /requiresFeatureOnBrowserAndActionAcceptance: true/);
});

test("new People Home page credit is pinned to real two-attacker, enabled-victim browser proof", () => {
  const entry = m.scopedPages.find(p => p.path === "src/app/hcm/command-center/page.tsx");
  assert.equal(entry?.status, "COVERED");
  assert.equal(entry.testedBy?.file, "scripts/qa/hcm-people-home-page-http.mjs");
  const source = readFileSync(entry.testedBy.file, "utf8");
  const lines = source.split("\n");
  const pin = (key) => lines[entry.testedBy[key] - 1];
  assert.match(pin("ownPositiveLine"), /const ownPage = await page\.goto\(/);
  assert.match(pin("foreignDenialLine"), /const foreignPage = await page\.goto\(/);
  assert.match(pin("unchangedDbLine"), /assert\.deepEqual\(await victimSnapshot\(\), before/);
  assert.match(source, /for \(const actor of expected\)/);
  assert.match(source, /assert\.equal\(ownPage\?\.status\(\), 200/);
  assert.match(source, /assert\.equal\(foreignPage\?\.status\(\), 404/);
  assert.match(source, /assert\.ok\(ownHtml\.includes\(actor\.workflow\)/);
  assert.match(source, /const ownHtml = \(await home\.textContent\(\)\) \?\? "";/,
    "CSS uppercase styling must not change persisted employer-name proof");
  assert.match(source, /process\.env\.HCM_PEOPLE_HOME_ORG_IDS, "1,2,3"/);
  assert.match(source, /new pg\.Client\(/);
  const browserSuite = readFileSync("scripts/hcm-people-home-synthetic-browser.mjs", "utf8");
  assert.match(browserSuite, /verifyIndependentPeopleHomeTenantProof\(\{ browser, base, login \}\)/);
  assert.match(source, /await home\.getByText\(actor\.employer/);
  assert.match(source, /await home\.getByText\(actor\.workflow/);
  assert.match(source, /"payroll_runs", "audit_events"/);

  const fixture = readFileSync("scripts/hcm-people-home-synthetic-fixture.ts", "utf8");
  assert.match(fixture, /"Synthetic Victim Only Employer"/);
  assert.match(fixture, /"VICTIM-ONLY-003"/);
  assert.match(fixture, /hcm-attacker-alpha@example\.test/);
  assert.match(fixture, /hcm-attacker-beta@example\.test/);
  assert.match(fixture, /victim\.id > beta\.id && victimWorker\.id > betaSecond\.id/);
  const workflow = readFileSync(".github/workflows/hcm-people-home-browser-qa.yml", "utf8");
  assert.match(workflow, /HCM_PEOPLE_HOME_ORG_IDS: "1,2,3"/);
  assert.match(workflow, /scripts\/qa\/hcm-people-home-page-http\.mjs/);
  assert.match(workflow, /node scripts\/hcm-people-home-synthetic-browser\.mjs/);
  assert.match(workflow, /npm run build/);
});
