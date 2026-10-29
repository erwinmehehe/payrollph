import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { POST_1523_CREDIT_SPECS, verifyPost1523Credits } from "../scripts/qa/tenant-post1523-credit-verify.mjs";

const load = () => JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const receipt = (manifest, spec) => manifest.allApiRouteFiles[spec.path].methods
  .find(m => m.name + " " + manifest.allApiRouteFiles[spec.path].route === spec.key);

test("exactly three source-pinned provisional credits reconcile, not production approval", () => {
  const manifest = load();
  assert.deepEqual(POST_1523_CREDIT_SPECS.map(s => s.key).sort(),
    ["PUT benefits","PATCH self/performance/action-items","POST workforce-planning/demand-handoff"].sort());
  assert.equal(verifyPost1523Credits(manifest), 3);
  for (const spec of POST_1523_CREDIT_SPECS) {
    assert.equal(receipt(manifest, spec).testedBy.productionCertified, false);
    assert.match(receipt(manifest, spec).testedBy.independentReview, /^PENDING:/);
  }
});

test("identity, failing evidence, missing actions and arbitrary fourth credit are rejected", () => {
  for (const spec of POST_1523_CREDIT_SPECS) {
    for (const change of [
      proof => { proof.prNumber++; },
      proof => { proof.foreignDenialLine++; },
      proof => { proof.unchangedDbLine = 1; },
      proof => { proof.methodActions = ["unproven single action"]; },
      proof => { proof.productionCertified = true; },
      proof => { proof.independentReview = "APPROVED"; },
      proof => { proof.proofBlobSha = "0".repeat(40); },
      proof => { delete proof.reviewedHead; },
    ]) {
      const manifest = load();
      change(receipt(manifest, spec).testedBy);
      assert.throws(() => verifyPost1523Credits(manifest), spec.key + ": altered receipt passed");
    }
    const tampered = load();
    receipt(tampered, spec).status = "GAP";
    assert.throws(() => verifyPost1523Credits(tampered), spec.key + ": uncredited method passed");
  }
  const altered = load();
  altered.allApiRouteFiles["src/app/api/invitations/route.ts"].methods
    .find(m => m.name === "POST").testedBy = {
      verifiedMainCommit: POST_1523_CREDIT_SPECS[0].evidence.verifiedMainCommit,
    };
  assert.throws(() => verifyPost1523Credits(altered), "Fourth credit must not pass");
});

test("route/proof/workflow source drift invalidates the historical passing receipt", () => {
  const manifest = load();
  for (const spec of POST_1523_CREDIT_SPECS) {
    for (const file of [spec.path, spec.evidence.file, spec.workflow]) {
      assert.throws(() => verifyPost1523Credits(manifest, name =>
        readFileSync(name, "utf8") + (name === file ? "\n// tampered source" : "")),
      spec.key + ": changed " + file + " silently retained credit");
    }
  }
});

test("manifest counts and acceptance gate are part of the fail-closed review", () => {
  const m = load();
  m.metrics.coveredAfter++;
  assert.throws(() => verifyPost1523Credits(m));
  const notAccepted = load();
  notAccepted.acceptanceStatus = "ACCEPTED";
  assert.throws(() => verifyPost1523Credits(notAccepted));
});
