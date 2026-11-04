import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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


test("inventory-only SHA edits run the complete source-pinned PG16 proof", () => {
  assert.equal(proofRequired({
    ...args, changed: [INVENTORY],
  }), true);
});

test("only the two uncredited opt-in workflows use relevance gating", () => {
  const fs = [
    "tenant-hcm-manager-attestation-recovery.yml",
    "tenant-v1-journal-http.yml",
  ];
  const pinned = [
    "salary-correction-cases-qa.yml",
    "tenant-benefit-catalog-put.yml",
    "tenant-dl01-closure.yml",
    "tenant-dl02-closure.yml",
    "tenant-dl02-qa.yml",
    "tenant-hcm-sla-escalate-http.yml",
    "tenant-onboarding-http.yml",
    "tenant-payout-profiles-patch-http.yml",
    "tenant-table-proof.yml",
  ];
  for (const workflow of fs) {
    const source = readFileSync(new URL("../.github/workflows/" + workflow,
      import.meta.url), "utf8");
    assert.ok(source.includes("node scripts/ci/tenant-proof-relevance.mjs"),
      workflow + ": expected fail-closed relevance check");
    assert.ok(source.includes("needs: relevance"),
      workflow + ": expensive proof may only run after relevance check");
    assert.ok(source.includes("scripts/qa/tenant-isolation-coverage-manifest.json"),
      workflow + ": manifest must still trigger");
    assert.ok(source.includes("scripts/ci/tenant-proof-relevance.mjs"),
      workflow + ": classifier edits must force the full proof");
  }
  for (const workflow of pinned) {
    const source = readFileSync(new URL("../.github/workflows/" + workflow,
      import.meta.url), "utf8");
    assert.ok(!source.includes("Tenant proof relevance (fast)"),
      workflow + ": previously executed source-pinned workflow must stay unmodified");
    assert.ok(source.includes("scripts/qa/tenant-isolation-coverage-manifest.json"),
      workflow + ": source-pinned real-HTTP evidence must still watch the manifest");
  }
});
