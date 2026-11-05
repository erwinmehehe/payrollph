import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertLiveTenantCounts } from "./helpers/tenant-counts.mjs";
import { verifyMoreCredits } from "../scripts/qa/tenant-more-credit-verify.mjs";
import { verifyFiveMethodCredits } from "../scripts/qa/tenant-five-method-credit-verify.mjs";

// These source pins supplement, NEVER substitute for, completed real PG16 HTTP.
const manifest = JSON.parse(readFileSync(
  "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));

test("three historical credits remain distinct from the later source-pinned self-profile proof", () => {
  assertLiveTenantCounts(assert, manifest);
  assert.equal(verifyMoreCredits(manifest), 3);
  const profile = manifest.allApiRouteFiles["src/app/api/self/profile/route.ts"];
  const patch = profile.methods.find(m => m.name === "PATCH");
  assert.equal(patch?.status, "COVERED", "New #1762 exact-source receipt, not the old #1518 receipt");
  assert.equal(patch?.testedBy?.proofPullRequest, 1762);
  assert.equal(patch?.testedBy?.independentlyAccepted, false);
  assert.equal(patch?.reviewedUncertified, undefined);
  assert.equal(profile.gitBlobSha, "41d26b23678e8822aff4701a611c429e97f659c3");
  const recovery = verifyFiveMethodCredits(manifest);
  assert.equal(recovery.methodsCredited, 3);
  assert.equal(recovery.methodsHeld, 2);
});

test("tampered source, forged receipt, fourth credit or invalid profile proof all fail closed", () => {
  const route = "src/app/api/self/schedule-receipts/route.ts";
  const tamper = fn => {
    const modified = structuredClone(manifest);
    fn(modified, modified.allApiRouteFiles[route].methods.find(m => m.name === "GET"));
    assert.throws(() => verifyMoreCredits(modified));
  };
  tamper((_m, entry) => { entry.testedBy.prNumber = 1492; });
  tamper((_m, entry) => { entry.testedBy.foreignDenialLine = 133; });
  tamper((_m, entry) => { entry.testedBy.proofBlobSha = "0".repeat(40); });
  tamper((_m, entry) => { entry.status = "GAP"; });
  tamper((_m, entry) => { entry.testedBy.file = "scripts/qa/tenant-table-http.mjs"; });
  tamper(modified => {
    modified.allApiRouteFiles["src/app/api/invitations/route.ts"].methods
      .find(m => m.name === "POST").testedBy = {
        verifiedMainCommit: "fe3ad8901bfa714d59639d9f59a13cf133eeab36"
      };
  });
  const profilePatch = m => m.allApiRouteFiles["src/app/api/self/profile/route.ts"]
    .methods.find(method => method.name === "PATCH");
  tamper(modified => { profilePatch(modified).status = "GAP"; });
  tamper(modified => { profilePatch(modified).testedBy = null; });
  tamper(modified => { profilePatch(modified).testedBy.proofBlobSha = "0".repeat(40); });
  tamper(modified => { profilePatch(modified).testedBy.proofHeadSha = "0".repeat(40); });
  tamper(modified => { profilePatch(modified).testedBy.ownerReviewer = "other-user"; });
  tamper(modified => { profilePatch(modified).testedBy.ownerAcceptance = "APPROVED"; });
  tamper(modified => { profilePatch(modified).testedBy.independentlyAccepted = true; });
  tamper(modified => { profilePatch(modified).reviewedUncertified = { reviewStatus: "APPROVED" }; });
  const source = "scripts/qa/tenant-self-schedule-receipts-http.mjs";
  assert.throws(() => verifyMoreCredits(manifest, path =>
    readFileSync(path, "utf8") + (path === source ? "\n// tampered" : "")),
    /reviewed source blob drift/);
});
