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


test("WRK-01's separate two-method proof can share the review SHA without borrowing #1591 credits", () => {
  const manifest = load();
  const staffing = manifest.allApiRouteFiles["src/app/api/workforce/demand-staffing/policies/route.ts"];
  assert.deepEqual(staffing.methods.map(m => [m.name, m.status]), [
    ["GET", "GAP"], ["POST", "COVERED"], ["PATCH", "COVERED"],
  ]);
  assert.equal(verifyPost1523Credits(manifest), 3,
    "#1591 continues to own exactly three proofs despite the separate staffing pair");
  for (const name of ["POST", "PATCH"]) {
    const evidence = staffing.methods.find(m => m.name === name).testedBy;
    assert.equal(evidence.file, "scripts/qa/tenant-wrk01-staffing-writes-http.mjs");
    assert.match(evidence.independentReview, /^PENDING/);
    assert.equal(evidence.productionCertified, false);
  }
});

test("co-located credits reject fake owners, partial promotion, modified pins and broadened scope", () => {
  const fixture = load();
  const route = "src/app/api/workforce/demand-staffing/policies/route.ts";
  const clone = () => structuredClone(fixture);
  const verifyReject = (mutate, what) => {
    const m = clone();
    mutate(m.allApiRouteFiles[route].methods, m);
    assert.throws(() => verifyPost1523Credits(m), what);
  };
  verifyReject(methods => {
    methods.find(m => m.name === "POST").status = "GAP";
  }, "partial staffing promotion cannot silently pass");
  verifyReject(methods => {
    methods.find(m => m.name === "PATCH").testedBy.reviewedHead = "0".repeat(40);
  }, "staffing source receipt cannot be rewritten");
  verifyReject(methods => {
    methods.find(m => m.name === "POST").testedBy.routeBlobSha = "0".repeat(40);
  }, "staffing route blob cannot be altered");
  verifyReject(methods => {
    methods.find(m => m.name === "PATCH").testedBy.methodActions = ["approve"];
  }, "all staffing PATCH transitions are required");
  verifyReject(methods => {
    methods.find(m => m.name === "POST").testedBy.independentReview = "APPROVED";
  }, "independent review may not be self-certified");
  verifyReject(methods => {
    methods.find(m => m.name === "POST").testedBy.productionCertified = true;
  }, "production certification may not be inferred");
  verifyReject(methods => {
    methods.find(m => m.name === "GET").status = "COVERED";
  }, "staffing GET may not receive a sibling credit");
  verifyReject(methods => {
    methods.find(m => m.name === "POST").testedBy.verifiedMainCommit = "0".repeat(40);
  }, "original reviewed-main SHA cannot be rewritten");
  verifyReject((_methods, m) => {
    m.allApiRouteFiles["src/app/api/invitations/route.ts"].methods
      .find(x => x.name === "POST").testedBy = {
        verifiedMainCommit: "5a3c209dffb2198e8944d0781025c42b117024b0",
        file: "scripts/qa/tenant-wrk01-staffing-writes-http.mjs",
      };
  }, "arbitrary fourth/sixth credits must fail despite copied proof file");
  for (const path of [
    "src/app/api/workforce/demand-staffing/policies/route.ts",
    "scripts/qa/tenant-wrk01-staffing-writes-http.mjs",
    "scripts/qa/tenant-wrk01-staffing-writes-contract.mjs",
    ".github/workflows/tenant-wrk01-staffing-writes-http.yml",
  ]) assert.throws(() => verifyPost1523Credits(clone(), name =>
    readFileSync(name,"utf8") + (name === path ? "\n// forged proof modification" : "")
  ), path + " source modification must fail closed");
});
