import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { EVIDENCE, verifyFiveMethodCredits } from "../scripts/qa/tenant-five-method-credit-verify.mjs";

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
  assert.deepEqual(verifyFiveMethodCredits(), {
    status: "PASS", label: "SOLO_VERIFIED_DEV_RECOVERY", methodsCredited: 3,
    methodsHeld: 2, covered: 410, publicByDesign: 10, gap: 78,
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
