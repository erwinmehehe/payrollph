/** Reviewed, bounded reconciliation of merged HTTP evidence. No generic count credits. */
import assert from "node:assert/strict";
import { verifyPost1523Credits } from "./tenant-post1523-credit-verify.mjs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const MERGED_PROOF_SPECS = Object.freeze([
  { route: "benefits", method: "GET", file: "tenant-benefit-enrollments-http.mjs", own: 95, foreign: 101, forged: 102, unchanged: 185, ordering: 76, ownStatus: 200 },
  { route: "benefits", method: "POST", file: "tenant-benefit-enrollments-http.mjs", own: 112, foreign: 123, forged: 125, unchanged: 185, ordering: 76, ownStatus: 201 },
  { route: "benefits", method: "DELETE", file: "tenant-benefit-enrollments-http.mjs", own: 132, foreign: 130, forged: 132, unchanged: 185, ordering: 77, ownStatus: 200 },
  { route: "workforce/worksites", method: "GET", file: "tenant-worksites-http.mjs", own: 99, foreign: 103, forged: 104, unchanged: 197, ordering: 68, ownStatus: 200 },
]);

const RECEIPTS = {
  "tenant-benefit-enrollments-http.mjs": {
    sha256: "c75826634a668a65228c4144e319fe390c3db14bfcac90bd3093d2d9eba74caf", head: "a112b8dd7a558bf9c2462d0e48dc2773219ff4f2",
    job: "https://github.com/erwinmehehe/payrollph/actions/runs/40084883554/job/120845670288",
    entry: "verifyBenefitEnrollmentIsolation",
  },
  "tenant-worksites-http.mjs": {
    sha256: "eca20ebc7c67d63d84396e4261e62f5ac30344fb3a7330195172f36c0fb9a55a", head: "d733b1f343cbdc05dfc3801fbaabc9268b25ce3e",
    job: "https://github.com/erwinmehehe/payrollph/actions/runs/40091436728/job/120864754791",
    entry: "verifyWorksiteIsolation",
  },
};

export function verifyMergedProofCredits(manifest, read = file => readFileSync(file, "utf8")) {
  const runner = read("scripts/qa/tenant-second-pass-http.mjs");
  const expected = new Set(MERGED_PROOF_SPECS.map(s => s.method + " " + s.route));
  const credited = Object.values(manifest.allApiRouteFiles).flatMap(row => row.methods
    .filter(m => Object.keys(RECEIPTS).some(file => m.testedBy?.file === "scripts/qa/" + file))
    .map(m => m.name + " " + row.route));
  assert.deepEqual(credited.sort(), [...expected].sort(), "Only four reviewed route+verb pairs may cite merged evidence");
  for (const spec of MERGED_PROOF_SPECS) {
    const key = spec.method + " " + spec.route;
    const path = "scripts/qa/" + spec.file;
    const receipt = RECEIPTS[spec.file];
    const source = read(path);
    assert.equal(createHash("sha256").update(source).digest("hex"), receipt.sha256,
      key + ": changed HTTP proof requires renewed source and CI review");
    const row = manifest.allApiRouteFiles["src/app/api/" + spec.route + "/route.ts"];
    const method = row?.methods.find(m => m.name === spec.method);
    assert.equal(method?.status, "COVERED", key);
    assert.deepEqual(method.testedBy, {
      file: path, line: spec.own, ownPositiveLine: spec.own, foreignDenialLine: spec.foreign,
      forgedSelectorLine: spec.forged, unchangedDbLine: spec.unchanged,
      victimIdOrderingLine: spec.ordering, ownStatus: spec.ownStatus, foreignStatus: 403,
      reviewedHead: receipt.head, passedJob: receipt.job,
    }, key + ": all pins and actual CI receipts are required");
    const lines = source.split("\n");
    assert.match(lines[spec.own - 1], /expectStatus\(await request\(/, key + ": own HTTP request");
    assert.match(lines[spec.foreign - 1], /await denied\(/, key + ": real victim denial");
    assert.match(lines.slice(spec.foreign - 1, spec.foreign + 2).join("\n"), /403,/, key);
    assert.match(lines[spec.unchanged - 1], /assert.deepEqual\(await snapshot\(victim.id\), before/, key);
    assert.match(lines[spec.ordering - 1], /> 6 &&/, key);
    assert.ok(source.includes('for (const idx of [1, 2])'), key + ": independent attackers");
    assert.ok(runner.includes(receipt.entry + "(f, { request, expectStatus, makeSession })"), key + ": executed suite");
  }
  const benefitPut = manifest.allApiRouteFiles["src/app/api/benefits/route.ts"].methods.find(m => m.name === "PUT");
  const worksitePost = manifest.allApiRouteFiles["src/app/api/workforce/worksites/route.ts"].methods.find(m => m.name === "POST");
  assert.equal(benefitPut?.status, "COVERED", "Only the exact source-pinned benefit PUT may be credited");
  assert.equal(verifyPost1523Credits(manifest, read), 3,
    "No other route may borrow the new four-part receipts");
  // The three-action partial suite and the table row's create_worksite can never certify the handler. The method is
  // COVERED only through the separate ten-action proof, which must name every action.
  if (worksitePost?.status === "COVERED") {
    assert.equal(worksitePost.testedBy?.file, "scripts/qa/tenant-worksites-actions-http.mjs",
      "Three tested actions cannot certify every worksite POST action");
    assert.equal(worksitePost.testedBy.methodActions?.length, 10, "every worksite POST action must be named by the proof");
  } else {
    assert.equal(worksitePost?.status, "GAP", "Three tested actions cannot certify every worksite POST action");
  }
  return MERGED_PROOF_SPECS.length;
}
