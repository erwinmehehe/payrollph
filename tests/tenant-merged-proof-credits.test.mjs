import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MERGED_PROOF_SPECS, verifyMergedProofCredits } from "../scripts/qa/tenant-merged-proof-credits.mjs";

const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
function method(value, spec) {
  return value.allApiRouteFiles["src/app/api/" + spec.route + "/route.ts"].methods.find(row => row.name === spec.method);
}

test("four exact merged method receipts reconcile without crediting untested siblings", () => {
  assert.equal(verifyMergedProofCredits(manifest), 4);
  assert.deepEqual(MERGED_PROOF_SPECS.map(s => s.method + " " + s.route),
    ["GET benefits", "POST benefits", "DELETE benefits", "GET workforce/worksites"]);
  assert.deepEqual([manifest.metrics.coveredAfter, manifest.metrics.publicByDesign, manifest.metrics.gap], [162, 10, 322]);
});

for (const spec of MERGED_PROOF_SPECS) {
  for (const field of ["ownPositiveLine", "foreignDenialLine", "forgedSelectorLine",
    "unchangedDbLine", "victimIdOrderingLine", "reviewedHead", "passedJob"]) {
    test(spec.method + " " + spec.route + " rejects missing " + field, () => {
      const broken = structuredClone(manifest);
      delete method(broken, spec).testedBy[field];
      assert.throws(() => verifyMergedProofCredits(broken));
    });
  }
  test(spec.method + " " + spec.route + " rejects shifted own-positive evidence", () => {
    const broken = structuredClone(manifest);
    method(broken, spec).testedBy.ownPositiveLine++;
    assert.throws(() => verifyMergedProofCredits(broken));
  });
}

test("source changes invalidate the previously passed receipt rather than borrowing it", () => {
  assert.throws(() => verifyMergedProofCredits(manifest, file =>
    readFileSync(file, "utf8") + (file.endsWith("tenant-worksites-http.mjs") ? "\n// modified proof" : "")),
  /changed HTTP proof requires renewed source and CI review/);
});

for (const [route, verb] of [["benefits", "PUT"], ["workforce/worksites", "POST"]]) {
  test(route + " " + verb + " cannot borrow sibling-method proof", () => {
    const broken = structuredClone(manifest);
    const sibling = method(broken, { route, method: verb });
    sibling.status = "COVERED";
    sibling.testedBy = structuredClone(method(broken, { route, method: "GET" }).testedBy);
    assert.throws(() => verifyMergedProofCredits(broken));
  });
}
