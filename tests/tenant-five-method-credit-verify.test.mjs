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
  assert.equal(live.coveredAfter + live.publicByDesign + live.gap, 498,
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
    methodsHeld: 2, covered: live.coveredAfter, publicByDesign: live.publicByDesign, gap: live.gap,
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

test("both transfer methods remain GAP even though #1711 source-identical job passed", () => {
  for (const name of ["POST", "PATCH"]) {
    mutation(m => {
      const transfer = m.allApiRouteFiles["src/app/api/multi-entity/transfers/route.ts"]
        .methods.find(x => x.name === name);
      transfer.status = "COVERED";
      transfer.testedBy = { file: "scripts/qa/tenant-multi-entity-transfers-write-http.mjs" };
    });
  }
});
