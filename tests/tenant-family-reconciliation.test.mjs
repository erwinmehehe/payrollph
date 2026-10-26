import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { RECONCILIATION_FILE, reviewedFamilySelection, verifyReconciledFamilyCredits } from "../scripts/qa/tenant-family-reconciliation.mjs";

const receipt = JSON.parse(readFileSync(RECONCILIATION_FILE, "utf8"));
const manifestFile = "scripts/qa/tenant-isolation-coverage-manifest.json";
const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));

test("reviewed final-head default HTTP receipts support exactly three bounded credits and eleven held methods", () => {
  assert.equal(reviewedFamilySelection().methods.size, 3);
  assert.equal(verifyReconciledFamilyCredits(manifest), 3);
  assert.equal(receipt.held.length, 11);
});

test("queued, failed, different-head or incomplete receipt evidence cannot select credits", () => {
  for (const change of [
    value => { value.reviewedHead = "a".repeat(40); },
    value => { value.profiles.default.conclusion = "queued"; },
    value => { value.profiles["multi-entity"].conclusion = "failure"; },
    value => { delete value.profiles["flagged-reads"]; },
    value => { value.profiles.default.job = 121308491508; },
    value => { value.defaultSummary.writePairs = 0; },
    value => { value.defaultSummary.victimDatabaseUnchanged = false; },
    value => { value.defaultSummary.certified = true; },
  ]) {
    const changed = structuredClone(receipt); change(changed); assert.throws(() => reviewedFamilySelection(changed));
  }
});

test("changed family/route source and promotion of partial action evidence require renewed review", () => {
  for (const file of Object.keys(receipt.sources)) {
    assert.throws(() => reviewedFamilySelection(receipt, path => readFileSync(path, "utf8") + (path === file ? "\n// edited" : "")), /changed proof\/route/);
  }
  const changed = structuredClone(receipt); changed.accepted.push(changed.held.shift());
  assert.throws(() => reviewedFamilySelection(changed), /only three/);
  const omitted = structuredClone(receipt); omitted.held.pop();
  assert.throws(() => reviewedFamilySelection(omitted));
  const expanded = structuredClone(receipt); expanded.accepted[0].scope = "All roles, actions, employers and production behavior are now certified.";
  assert.throws(() => reviewedFamilySelection(expanded), /accepted scopes/);
});

test("manifest credits retain exact receipt/scope and cannot promote an untested handler action", () => {
  for (const change of [
    value => { value.allApiRouteFiles["src/app/api/enterprise/route.ts"].methods.find(m => m.name === "GET").testedBy.passedJob = "wrong"; },
    value => { value.allApiRouteFiles["src/app/api/organizations/route.ts"].methods[0].testedBy.scope = "whole application certified"; },
    value => { value.allApiRouteFiles["src/app/api/developer/route.ts"].methods.find(m => m.name === "POST").status = "COVERED"; },
  ]) { const changed = structuredClone(manifest); change(changed); assert.throws(() => verifyReconciledFamilyCredits(changed)); }
});

test("selection is idempotent, writes nothing in check mode and preserves curated provenance", () => {
  const before = readFileSync(manifestFile, "utf8");
  const output = JSON.parse(execFileSync(process.execPath, ["scripts/qa/tenant-table-credit.mjs", "--reconcile-merged-families", "--check"], { encoding: "utf8" }));
  assert.equal(output.newlyCredited, 0); assert.deepEqual(output.before, output.after);
  assert.equal(readFileSync(manifestFile, "utf8"), before);
  const baseRef = process.env.FAIL_CLOSED_GUARD_BASE_REF || "origin/main";
  const base = JSON.parse(execFileSync("git", ["show", baseRef + ":" + manifestFile], { encoding: "utf8", maxBuffer: 32 << 20 }));
  const selected = new Set(receipt.accepted.map(row => row.key));
  const changed = [];
  for (const [file, entry] of Object.entries(base.allApiRouteFiles)) for (const method of entry.methods) {
    const now = manifest.allApiRouteFiles[file].methods.find(item => item.name === method.name), key = method.name + " " + entry.route;
    if (now.status !== method.status) changed.push(key);
    if (!selected.has(key)) assert.deepEqual(now, method, key + ": existing proof ownership/scope/status must be preserved");
  }
  const newlyEligible = receipt.accepted.map(row => row.key).filter(key => {
    const [verb, route] = key.split(" ");
    return base.allApiRouteFiles["src/app/api/" + route + "/route.ts"].methods.find(method => method.name === verb).status === "GAP";
  });
  assert.deepEqual(changed.sort(), newlyEligible.sort());
});
