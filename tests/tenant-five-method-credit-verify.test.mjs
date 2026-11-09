import { verifyYearEndCredits } from "../scripts/qa/tenant-year-end-credit.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { EVIDENCE, verifyFiveMethodCredits } from "../scripts/qa/tenant-five-method-credit-verify.mjs";
import { tallyTenantManifest } from "./helpers/tenant-counts.mjs";

const readManifest = () => JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const mutation = (change) => {
  const manifest = readManifest();
  change(manifest);
  assert.throws(() => verifyFiveMethodCredits(manifest));
};

test("only three final-head PG16 source-identical methods get SOLO_VERIFIED_DEV_RECOVERY credits", () => {
  assert.deepEqual(EVIDENCE.map(e => e.method + " " + e.route).sort(), [
    "PATCH self/profile", "POST hcm/salary-corrections/preview", "POST invitations",
  ].sort());
  const manifest = readManifest();
  const live = tallyTenantManifest(manifest);
  assert.equal(live.coveredAfter + live.publicByDesign + live.privilegedOperationsTokenOnly + live.gap, 498,
    "All 498 API methods must still have exactly one status");
  const yearEnd = manifest.allApiRouteFiles["src/app/api/year-end/route.ts"];
  assert.equal(yearEnd.gitBlobSha, "f040f5bbbc3df275d32d23f1728b1b0345f77814",
    "Atomic year-end changed source must not borrow the old PG16 receipts");
  assert.equal(verifyYearEndCredits(manifest), 2,
    "Only the separate executed #1804 current-source PG16 proof can re-credit year-end");
  for (const method of yearEnd.methods) {
    assert.ok(["GET", "POST"].includes(method.name));
    assert.equal(method.status, "COVERED");
    assert.equal(method.testedBy?.proofPullRequest, 1804);
    assert.equal(method.testedBy?.independentlyAccepted, false);
    assert.equal(method.reviewedUncertified, undefined);
  }
  assert.deepEqual(verifyFiveMethodCredits(manifest), {
    status: "PASS", label: "SOLO_VERIFIED_DEV_RECOVERY", methodsCredited: 3,
    methodsHeld: 0, covered: live.coveredAfter, publicByDesign: live.publicByDesign, gap: live.gap,
    pageActionGaps: 17, productionTested: false, independentlyAccepted: false,
  });
});

test("missing exact proof receipt or a fake reviewer is a hard failure", () => {
  mutation(m => m.allApiRouteFiles["src/app/api/invitations/route.ts"].methods
    .find(x => x.name === "POST").testedBy.workflowRunId = 0);
  mutation(m => m.allApiRouteFiles["src/app/api/self/profile/route.ts"].methods
    .find(x => x.name === "PATCH").testedBy.ownerReviewer = "somebody-else");
  mutation(m => m.allApiRouteFiles["src/app/api/hcm/salary-corrections/preview/route.ts"].methods
    .find(x => x.name === "POST").testedBy.independentlyAccepted = true);
});

test("changed proof citations, source SHA, or method totals are not a valid credit", () => {
  mutation(m => m.allApiRouteFiles["src/app/api/self/profile/route.ts"].methods
    .find(x => x.name === "PATCH").testedBy.ownPositiveLine = 1);
  mutation(m => m.allApiRouteFiles["src/app/api/invitations/route.ts"].gitBlobSha = "not-the-source-sha");
  mutation(m => m.metrics.coveredAfter++);
});

test("a transfer credit is valid only from the dedicated #1853 proof; the old candidate, a forged run or a leftover hold fail closed", () => {
  const transfer = (m, name) => m.allApiRouteFiles["src/app/api/multi-entity/transfers/route.ts"].methods.find(x => x.name === name);
  for (const name of ["POST", "PATCH"]) {
    // The superseded Playwright candidate can never support a credit.
    mutation(m => { transfer(m, name).testedBy = { file: "scripts/qa/tenant-multi-entity-transfers-write-http.mjs" }; });
    // A forged owner, run, head, review, acceptance or source claim is a hard failure.
    mutation(m => { transfer(m, name).testedBy.proofPullRequest = 1711; });
    mutation(m => { transfer(m, name).testedBy.workflowRunId = 42477461862; });
    mutation(m => { transfer(m, name).testedBy.verifiedPrHeadSha = "0".repeat(40); });
    mutation(m => { transfer(m, name).testedBy.independentlyAccepted = true; });
    mutation(m => { transfer(m, name).testedBy.independentSecurityReview = "PASSED"; });
    mutation(m => { transfer(m, name).testedBy.proofBlobSha = "0".repeat(40); });
    mutation(m => { transfer(m, name).testedBy.ownPositiveLine = 1e9; });
    // The superseded hold must be removed, not kept beside a credit.
    mutation(m => { transfer(m, name).reviewedUncertified = { kind: "multi-entity-transfers-typed-conflict-PG16-fault-proof-uncredited", coverageCredits: 0 }; });
    // A COVERED status with no receipt at all.
    mutation(m => { transfer(m, name).testedBy = null; });
  }
});
