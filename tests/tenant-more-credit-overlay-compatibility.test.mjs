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

test("historical issued GET credit survives only the exact reviewed GET-only change", () => {
  const manifest = load();
  const entry = manifest.allApiRouteFiles[issuedRoute];
  assert.equal(entry.gitBlobSha, "d552c6db5a54b346d8fb940edb5f0ceaaeff04a0");
  assert.equal(entry.methods.find(m => m.name === "GET")?.testedBy?.routeBlobSha,
    "d9e6ae99e687b691ca428e58c6c34ff077769a41",
    "Historical proof must keep naming its original reviewed source");
  assert.equal(assertHistoricalDemandSourceCompatible(issuedRoute, entry), 
    "d9e6ae99e687b691ca428e58c6c34ff077769a41");
  assert.equal(assertHistoricalDemandSourceCompatible(staffingRoute,
    manifest.allApiRouteFiles[staffingRoute]),
    "513975b118713becbf98caffa7d813a5b8c33c71");
  assert.equal(verifyMoreCredits(manifest), 3,
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
    assert.throws(() => verifyMoreCredits(manifest, file =>
      read(file) + (file === path ? "\n// unauthorized modification" : "")),
      "Any changed route or independently pinned evidence must fail: " + path);
  }
});

test("historical GET credit cannot be promoted or used to certify issued POST", () => {
  const original = load();
  for (const mutate of [
    entry => { entry.methods.find(m => m.name === "GET").status = "GAP"; },
    entry => { entry.methods.find(m => m.name === "GET").testedBy.routeBlobSha = entry.gitBlobSha; },
    entry => { entry.methods.find(m => m.name === "GET").reviewedUncertified.methodCredits = 1; },
    entry => { entry.methods.find(m => m.name === "GET").reviewedUncertified.productionCertified = true; },
    entry => { entry.methods.find(m => m.name === "POST").status = "COVERED"; },
    entry => { entry.methods.find(m => m.name === "POST").testedBy = { routeBlobSha: entry.gitBlobSha }; },
    entry => { entry.gitBlobSha = "d9e6ae99e687b691ca428e58c6c34ff077769a41"; },
  ]) {
    const changed = structuredClone(original);
    mutate(changed.allApiRouteFiles[issuedRoute]);
    assert.throws(() => verifyMoreCredits(changed),
      "Historical receipt cannot certify a changed status, source or unrevised write");
  }
});
