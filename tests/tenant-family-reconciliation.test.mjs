import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, cpSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
  const selected = new Set(receipt.accepted.map(row => row.key));
  const outputs = resolve("outputs"); mkdirSync(outputs, { recursive: true });
  const sandbox = mkdtempSync(join(outputs, "credit-reconciliation-test-"));
  try {
    // Exercise the actual writer, preserving unrelated legitimate branch credits.
    cpSync("scripts/qa", join(sandbox, "scripts/qa"), { recursive: true });
    const overview = "docs/engineering/tenant-isolation-coverage-inventory.md";
    mkdirSync(dirname(join(sandbox, overview)), { recursive: true });
    cpSync(overview, join(sandbox, overview));
    for (const file of Object.keys(receipt.sources)) {
      mkdirSync(dirname(join(sandbox, file)), { recursive: true }); cpSync(file, join(sandbox, file));
    }
    const input = structuredClone(manifest);
    for (const entry of Object.values(input.allApiRouteFiles)) for (const method of entry.methods) {
      if (selected.has(method.name + " " + entry.route)) {
        method.status = "GAP"; method.testedBy = null; method.reason = "Fictional uncredited reconciliation fixture";
      }
    }
    const methods = Object.values(input.allApiRouteFiles).flatMap(entry => entry.methods);
    input.metrics.coveredAfter = methods.filter(method => method.status === "COVERED").length;
    input.metrics.gap = methods.filter(method => method.status === "GAP").length;
    writeFileSync(join(sandbox, manifestFile), JSON.stringify(input));
    const args = ["scripts/qa/tenant-table-credit.mjs", "--reconcile-merged-families", "--run-label", "isolated reconciliation regression"];
    const first = JSON.parse(execFileSync(process.execPath, args, { cwd: sandbox, encoding: "utf8" }));
    assert.equal(first.newlyCredited, selected.size);
    const actual = JSON.parse(readFileSync(join(sandbox, manifestFile), "utf8"));
    const changed = [];
    for (const [file, entry] of Object.entries(input.allApiRouteFiles)) for (const method of entry.methods) {
      const now = actual.allApiRouteFiles[file].methods.find(item => item.name === method.name), key = method.name + " " + entry.route;
      if (now.status !== method.status) changed.push(key);
      if (!selected.has(key)) assert.deepEqual(now, method, key + ": existing proof ownership/scope/status must be preserved");
    }
    assert.deepEqual(changed.sort(), [...selected].sort());
    assert.equal(verifyReconciledFamilyCredits(actual), selected.size);
    const second = JSON.parse(execFileSync(process.execPath, args, { cwd: sandbox, encoding: "utf8" }));
    assert.equal(second.newlyCredited, 0);
    assert.deepEqual(JSON.parse(readFileSync(join(sandbox, manifestFile), "utf8")), actual);
    assert.equal(readFileSync(manifestFile, "utf8"), before);
  } finally {
    assert.equal(dirname(sandbox), outputs); rmSync(sandbox, { recursive: true });
  }
});

test("labor-costing GET-only source repin does not certify the legacy POST", () => {
  const file = "src/app/api/workforce/labor-costing/route.ts";
  const baseRef = process.env.FAIL_CLOSED_GUARD_BASE_REF || "origin/main";
  const baseline = JSON.parse(execFileSync("git", ["show", baseRef + ":" + manifestFile], {
    encoding: "utf8", maxBuffer: 32 << 20,
  }));
  const old = baseline.allApiRouteFiles[file];
  const current = manifest.allApiRouteFiles[file];
  assert.equal(current.gitBlobSha, "4b98d27a02ccd6fbfb76ad08cb501410a8fd67bd");
  const oldGet = old.methods.find(method => method.name === "GET");
  const newGet = current.methods.find(method => method.name === "GET");
  assert.equal(oldGet.line, 78); assert.equal(newGet.line, 79);
  assert.deepEqual({ ...newGet, line: oldGet.line }, oldGet);
  const oldPost = old.methods.find(method => method.name === "POST");
  const newPost = current.methods.find(method => method.name === "POST");
  assert.equal(oldPost.line, 133); assert.equal(newPost.line, 156);
  assert.equal(newPost.status, "GAP");
  assert.equal(newPost.testedBy, null);
  const { reviewedUncertified, ...withoutReview } = newPost;
  assert.deepEqual({ ...withoutReview, line: oldPost.line, reason: oldPost.reason }, oldPost);
  assert.deepEqual(reviewedUncertified, {
    kind: "unchanged-POST-in-GET-only-security-fix",
    originalRouteBlobSha: "e5e2c007ca41da3c6e2fc1217600f83640f48975",
    routeBlobSha: "4b98d27a02ccd6fbfb76ad08cb501410a8fd67bd",
    unchangedPostBlobSha: "91bcb6ee054c538f72d65630cc89deb641cfa7f5",
    reason: "Only GET and an import changed; POST bytes are independently pinned and retain GAP/zero coverage credit. Real HTTP POST proof and independent review are still required.",
  });
});
