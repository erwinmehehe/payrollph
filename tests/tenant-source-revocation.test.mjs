import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertLiveTenantCounts } from "./helpers/tenant-counts.mjs";

const live = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const path = "src/app/api/year-end/route.ts";
function prior(liveManifest) {
  const base = structuredClone(liveManifest);
  const r = base.allApiRouteFiles[path];
  r.gitBlobSha = "7572c6111cf40d398b3cc8c1f940efd0a9b8d362";
  for (const m of r.methods) {
    m.status = "COVERED";
    m.testedBy = {
      routeBlobSha: r.gitBlobSha,
      verifiedPrHeadSha: "066c1d6b405365ff9ddacc229b8d0ce5cbc68aa5",
      workflowRunId: 41446394887,
      proofBlobSha: "9e64fc18a1a5b76c3ec583a0668ea680efd1ed19",
      workflowBlobSha: "9e6ca6431b168e05afecc5e40a42b1973ad1f675",
      independentlyAccepted: false,
      productionCertified: false,
      methodActions: m.name === "GET" ?
        ["json", "preflight", "2316", "2316-print", "alphalist"] :
        ["annualization", "bind-run"],
    };
    delete m.reviewedUncertified;
  }
  base.metrics.coveredAfter += 2;
  base.metrics.gap -= 2;
  return { ref: "synthetic pre-supersession", manifest: base };
}
function check(doc, old=prior(live)) { return assertLiveTenantCounts(assert, doc, {}, old); }
test("only the exact old year-end GET/POST proof pair is superseded; payout remains covered", () => {
  // Guard method status and source evidence, never a moving live-count constant.
  assert.deepEqual(live.allApiRouteFiles[path].methods.map(method =>
    [method.name, method.status, method.testedBy, method.reviewedUncertified?.credits]),
  [["GET", "GAP", null, 0], ["POST", "GAP", null, 0]]);
  assert.equal(live.metrics.coveredAfter + live.metrics.publicByDesign + live.metrics.gap,
    live.metrics.methods);
  assert.ok(check(live));
  assert.equal(live.allApiRouteFiles["src/app/api/payout-profiles/route.ts"].methods
    .find(m => m.name === "PATCH").status, "COVERED");
});
test("changed source, evidence pins, reviewer state, or half-revocation fail closed", () => {
  const mutations = [
    d => { d.allApiRouteFiles[path].gitBlobSha = "0".repeat(40); },
    d => { d.allApiRouteFiles[path].methods[0].reviewedUncertified.credits = 1; },
    d => { d.allApiRouteFiles[path].methods[0].reviewedUncertified.independentSecurityReview = "ACCEPTED"; },
    d => { d.allApiRouteFiles[path].methods[1].status = "COVERED";
      d.metrics.coveredAfter++; d.metrics.gap--;
      d.acceptanceStatus = d.acceptanceStatus.replace(
        "NOT ACCEPTED: " + live.metrics.gap + " API methods",
        "NOT ACCEPTED: " + (live.metrics.gap - 1) + " API methods"); },
  ];
  for (const mutate of mutations) {
    const d = structuredClone(live); mutate(d);
    assert.throws(() => check(d), "a changed or partial source-supersession is prohibited");
  }
  const base = prior(live);
  base.manifest.allApiRouteFiles[path].methods[0].testedBy.workflowRunId = 0;
  assert.throws(() => check(live, base), "historical source receipt must match");
});
test("unrelated payout credit cannot be revoked along with the year-end pair", () => {
  const d = structuredClone(live);
  const method = d.allApiRouteFiles["src/app/api/payout-profiles/route.ts"].methods.find(m => m.name === "PATCH");
  assert.equal(method.status, "COVERED");
  method.status = "GAP"; method.testedBy = null;
  d.metrics.coveredAfter--; d.metrics.gap++;
  d.acceptanceStatus = d.acceptanceStatus.replace(
    "NOT ACCEPTED: " + live.metrics.gap + " API methods",
    "NOT ACCEPTED: " + (live.metrics.gap + 1) + " API methods");
  assert.throws(() => check(d), "only two explicitly source-invalidated methods may be revoked");
});
