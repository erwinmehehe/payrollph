import { historicWorker360ProofView } from "../scripts/qa/tenant-five-scoped-page-credit.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifyMoreCredits } from "../scripts/qa/tenant-more-credit-verify.mjs";
import { assertHistoricalDemandSourceCompatible } from "../scripts/qa/tenant-wfm-demand-overlay-history.mjs";

const manifestFile = "scripts/qa/tenant-isolation-coverage-manifest.json";
const issuedRoute = "src/app/api/workforce/demand-observations/issued/route.ts";
const staffingRoute = "src/app/api/workforce/demand-staffing/policies/route.ts";
const read = path => readFileSync(path, "utf8");
const load = () => JSON.parse(read(manifestFile));

test("historical issued GET credit survives exact GET overlay plus POST-only authorization reorder", () => {
  const manifest = load();
  const entry = manifest.allApiRouteFiles[issuedRoute];
  // This is the exact reviewed GET-overlay route plus the later POST-only
  // role-before-pilot reordering. The compatibility validator reconstructs
  // both earlier blobs byte-for-byte and refuses unrelated changes.
  assert.equal(entry.gitBlobSha, "549156b2e143c71bd33385fb1cc49a95cb120dfc");
  const issuedPost = entry.methods.find(m => m.name === "POST");
  assert.equal(issuedPost?.status, "COVERED",
    "Issued POST now has a distinct real-HTTP PG16 credit, not the older GET receipt");
  assert.equal(issuedPost?.testedBy?.evidenceLabel, "SOLO_VERIFIED_DEV_RECOVERY");
  assert.equal(issuedPost?.testedBy?.workflowRunId, 41444835667);
  assert.equal(issuedPost?.testedBy?.independentlyAccepted, false);
  assert.equal(entry.methods.find(m => m.name === "GET")?.testedBy?.routeBlobSha,
    "d9e6ae99e687b691ca428e58c6c34ff077769a41",
    "Historical proof must keep naming its original reviewed source");
  assert.equal(assertHistoricalDemandSourceCompatible(issuedRoute, entry), 
    "d9e6ae99e687b691ca428e58c6c34ff077769a41");
  assert.equal(assertHistoricalDemandSourceCompatible(staffingRoute,
    manifest.allApiRouteFiles[staffingRoute]),
    "513975b118713becbf98caffa7d813a5b8c33c71");
  assert.equal(verifyMoreCredits(historicWorker360ProofView(manifest)), 3,
    "Only the original three reviewed method credits remain");
});

test("source drift and changed synthetic evidence fail closed instead of borrowing #1514 proof", () => {
  const manifest = load();
  for (const path of [
    issuedRoute,
    staffingRoute,
    "scripts/qa/tenant-wfm-demand-read-overlay-http.mjs",
    "tests/tenant-wfm-demand-read-overlay.test.mjs",
    ".github/workflows/tenant-wfm-demand-read-overlay-http.yml",
    "scripts/qa/tenant-demand-governance-recovery-http.mjs",
  ]) {
    const changedRead = file => read(file) +
      (file === path ? "\n// unauthorized modification" : "");
    if (path === staffingRoute) {
      // Staffing POST/PATCH historical proof belongs to the independent
      // WRK-01 verifier, not #1514's issued-demand GET sweep. Exercise its
      // exact-source reconstruction guard directly for this negative control.
      assert.throws(() => assertHistoricalDemandSourceCompatible(
        staffingRoute, manifest.allApiRouteFiles[staffingRoute], changedRead),
      "Staffing historical proof must refuse a changed route: " + path);
    } else {
      assert.throws(() => verifyMoreCredits(historicWorker360ProofView(manifest), changedRead),
        "Issued GET or pinned evidence must fail: " + path);
    }
  }
});

test("historical GET credit cannot be promoted or used to certify issued POST", () => {
  const original = load();
  for (const mutate of [
    entry => { entry.methods.find(m => m.name === "GET").status = "GAP"; },
    entry => { entry.methods.find(m => m.name === "GET").testedBy.routeBlobSha = entry.gitBlobSha; },
    entry => { entry.methods.find(m => m.name === "GET").reviewedUncertified.methodCredits = 1; },
    entry => { entry.methods.find(m => m.name === "GET").reviewedUncertified.productionCertified = true; },
    entry => { entry.methods.find(m => m.name === "POST").status = "GAP"; },
    entry => { entry.methods.find(m => m.name === "POST").testedBy = { routeBlobSha: entry.gitBlobSha }; },
    entry => { entry.gitBlobSha = "d9e6ae99e687b691ca428e58c6c34ff077769a41"; },
  ]) {
    const changed = structuredClone(original);
    mutate(changed.allApiRouteFiles[issuedRoute]);
    assert.throws(() => verifyMoreCredits(historicWorker360ProofView(changed)),
      "Historical receipt cannot certify a changed status, source or unrevised write");
  }
});
