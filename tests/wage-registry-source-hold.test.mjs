import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  WAGE_SOURCE_HELD_METHODS, verifyWageRegistrySourceHold,
  verifyAllWageRegistrySourceHolds, reviewedWageRegistrySourceWithdrawals,
  historicWageRegistryProofView,
} from "../scripts/qa/wage-registry-source-hold.mjs";

const readManifest = () => JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const firstKey = WAGE_SOURCE_HELD_METHODS[0];
const split = key => {
  const at = key.lastIndexOf(" ");
  return [key.slice(0, at), key.slice(at + 1)];
};
const clone = value => JSON.parse(JSON.stringify(value));

test("all 23 previously credited wage-dependent methods are now held with zero credits", () => {
  const manifest = readManifest();
  assert.equal(WAGE_SOURCE_HELD_METHODS.length, 23);
  assert.equal(verifyAllWageRegistrySourceHolds(manifest).length, 23);
  const counts=manifest.metrics;
  assert.equal(counts.coveredAfter+counts.publicByDesign+counts.privilegedOperationsTokenOnly+counts.gap,counts.methods);
  for (const key of WAGE_SOURCE_HELD_METHODS) {
    const [path, verb] = split(key);
    const method = manifest.allApiRouteFiles[path].methods.find(m => m.name === verb);
    assert.equal(method.status, "GAP");
    assert.equal(method.testedBy, null);
    assert.equal(method.reviewedUncertified.coverageCredits, 0);
    assert.equal(method.reviewedUncertified.productionCertified, false);
  }
});

test("historical view restores only exactly verified old receipts without changing live holds", () => {
  const live = readManifest();
  const original = clone(live);
  const historical = historicWageRegistryProofView(live);
  assert.deepEqual(live, original, "Historical projection must not mutate the live manifest");
  assert.equal(historical.metrics.gap, live.metrics.gap - 23);
  assert.equal(historical.metrics.coveredAfter, live.metrics.coveredAfter + 23);
  assert.equal(historical.metrics.methods, live.metrics.methods);
  const changed = [];
  for (const [path, file] of Object.entries(live.allApiRouteFiles)) {
    for (const row of file.methods) {
      const old = historical.allApiRouteFiles[path].methods.find(m => m.name === row.name);
      if (old.status !== row.status) changed.push(path + " " + row.name);
      if (row.reviewedUncertified?.kind === "wage-registry-dependency-source-withdrawal") {
        assert.equal(row.status, "GAP");
        assert.equal(row.testedBy, null);
        assert.equal(old.status, "COVERED");
        assert.deepEqual(old.testedBy, row.reviewedUncertified.priorProof);
      } else {
        assert.equal(old.status, row.status, "Unrelated API methods must never be reclassified");
        assert.deepEqual(old.testedBy, row.testedBy);
      }
    }
  }
  assert.deepEqual(changed.sort(), [...WAGE_SOURCE_HELD_METHODS].sort());
  const forged = clone(live);
  const [path, verb] = split(firstKey);
  forged.allApiRouteFiles[path].methods.find(m => m.name === verb).reviewedUncertified.coverageCredits = 1;
  assert.throws(() => historicWageRegistryProofView(forged),
    /Expected values to be strictly equal|coverageCredits/);
  const partial = clone(live);
  partial.allApiRouteFiles[path].methods.find(m => m.name === verb).reviewedUncertified.kind = "unreviewed";
  assert.throws(() => historicWageRegistryProofView(partial), /Partial or extra wage source holds/);
});

test("a missing hold, old credit, or changed source is rejected without awarding coverage", () => {
  const manifest = readManifest();
  const [path, verb] = split(firstKey);
  const changedStatus = clone(manifest);
  changedStatus.allApiRouteFiles[path].methods.find(m => m.name === verb).status = "COVERED";
  assert.throws(() => verifyAllWageRegistrySourceHolds(changedStatus), /explicitly HELD/);

  const changedClaim = clone(manifest);
  changedClaim.allApiRouteFiles[path].methods.find(m => m.name === verb).testedBy = { file: "unreviewed" };
  assert.throws(() => verifyWageRegistrySourceHold(changedClaim, path, verb), /withdrawn/);

  const changedSource = (name) => {
    const source = readFileSync(name);
    return name.endsWith("wage-orders.ts")
      ? Buffer.concat([source, Buffer.from("\n// unreviewed wage change")])
      : source;
  };
  assert.throws(() => verifyWageRegistrySourceHold(manifest, path, verb, changedSource),
    /changed again/);
});

test("only the exact historical base method proof may be downgraded", () => {
  const main = readManifest();
  const before = clone(main);
  for (const key of WAGE_SOURCE_HELD_METHODS) {
    const [path, verb] = split(key);
    const prior = main.allApiRouteFiles[path].methods.find(m => m.name === verb);
    const old = before.allApiRouteFiles[path].methods.find(m => m.name === verb);
    old.status = "COVERED";
    old.testedBy = clone(prior.reviewedUncertified.priorProof);
    delete old.reviewedUncertified;
  }
  assert.equal(reviewedWageRegistrySourceWithdrawals(before, main).size, 23);
  const altered = clone(before);
  const [path, verb] = split(firstKey);
  altered.allApiRouteFiles[path].methods.find(m => m.name === verb).testedBy.scope = "fabricated approval";
  assert.throws(() => reviewedWageRegistrySourceWithdrawals(altered, main),
    /must exactly match the PR's base/);
});
