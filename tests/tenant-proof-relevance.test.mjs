import test from "node:test";
import assert from "node:assert/strict";
import {
  MANIFEST, INVENTORY, workflowPaths, matchesGlob,
  onlyUnacceptedManifestRepins, onlyInventoryHashRepins, proofRequired,
} from "../scripts/ci/tenant-proof-relevance.mjs";

const old = "a".repeat(40), updated = "b".repeat(40);
const sample = sha => JSON.stringify({
  metrics: { methods: 498, coveredAfter: 400, gap: 88 },
  allApiRouteFiles: {
    "src/app/api/careers/admin/route.ts": { methods: [{
      name: "PATCH", status: "GAP", testedBy: null,
      reviewedUncertified: { coverageCredits: 0, proofBlobSha: sha,
        contractBlobSha: sha, independentSecurityReview: "PENDING",
        productionCertified: false },
    }] },
  },
});
const source = [
  "on:", "  pull_request:", "    branches: [main]", "    paths:",
  "      - '.github/workflows/tenant-benefit-catalog-put.yml'",
  "      - 'src/app/api/benefits/route.ts'",
  "      - 'scripts/qa/tenant-isolation-coverage-manifest.json'",
  "      - 'tests/tenant-isolation-coverage-inventory.test.mjs'",
  "permissions:", "  contents: read",
].join("\n");
const paths = workflowPaths(source);
const args = {
  paths, changed: [MANIFEST, INVENTORY,
    "scripts/qa/tenant-edg01-careers-publication-http.mjs"],
  manifestBefore: sample(old), manifestAfter: sample(updated),
  inventoryBefore: 'const a = "' + old + '";',
  inventoryAfter: 'const a = "' + updated + '";',
};

test("read workflow filters without broadening source patterns", () => {
  assert.deepEqual(paths, [".github/workflows/tenant-benefit-catalog-put.yml",
    "src/app/api/benefits/route.ts", MANIFEST, INVENTORY]);
  assert.throws(() => workflowPaths("on:\n  pull_request:\n"));
  assert.equal(matchesGlob("src/app/api/**", "src/app/api/careers/admin/route.ts"), true);
  assert.equal(matchesGlob("src/lib/**", "src/app/api/careers/route.ts"), false);
  assert.equal(matchesGlob("scripts/qa/tenant-edg01-*.mjs", "scripts/qa/tenant-edg01-http.mjs"), true);
});

test("unrelated unaccepted source SHA repins skip expensive proof", () => {
  assert.equal(onlyUnacceptedManifestRepins(sample(old), sample(updated)), true);
  assert.equal(onlyInventoryHashRepins(args.inventoryBefore, args.inventoryAfter), true);
  assert.equal(proofRequired(args), false);
});

test("targeted API, helper or workflow changes still run", () => {
  assert.equal(proofRequired({ ...args, changed: [...args.changed, "src/app/api/benefits/route.ts"] }), true);
  assert.equal(proofRequired({ ...args, changed: [...args.changed,
    "scripts/ci/tenant-proof-relevance.mjs"],
    paths: [...paths, "scripts/ci/tenant-proof-relevance.mjs"] }), true);
});

test("manifest acceptance, metric, credit and reviewer changes fail closed", () => {
  for (const mutate of [
    o => { o.metrics.coveredAfter++; },
    o => { o.allApiRouteFiles["src/app/api/careers/admin/route.ts"].methods[0].status = "COVERED"; },
    o => { o.allApiRouteFiles["src/app/api/careers/admin/route.ts"].methods[0].reviewedUncertified.coverageCredits = 1; },
    o => { o.allApiRouteFiles["src/app/api/careers/admin/route.ts"].methods[0].reviewedUncertified.independentSecurityReview = "ACCEPTED"; },
  ]) {
    const parsed = JSON.parse(sample(updated)); mutate(parsed);
    assert.equal(onlyUnacceptedManifestRepins(sample(old), JSON.stringify(parsed)), false);
    assert.equal(proofRequired({ ...args, manifestAfter: JSON.stringify(parsed) }), true);
  }
});

test("inventory logic changes and unknown changes cannot skip proof", () => {
  assert.equal(onlyInventoryHashRepins("assert.ok(true);", "assert.ok(false);"), false);
  assert.equal(proofRequired({ ...args, inventoryAfter: "assert.ok(false);" }), true);
  assert.equal(proofRequired({ ...args, changed: [] }), true);
});
