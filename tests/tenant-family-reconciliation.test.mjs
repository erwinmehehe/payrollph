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

// #1402's independently executed People/platform and Performance method credits
// are distinct from the three bounded credits reviewed under #1423. Keep their
// exact row sources and historical disposable PG16/HTTP receipts immutable.
test("PR #1402 preserves fourteen independent proof receipts and the incomplete worksite GAP", () => {
  const families = [
    ["scripts/qa/tenant-table-rows/write/people.mjs",
      ["PATCH discipline", "PATCH provisioning", "POST dynamic-worker-groups", "POST recruitment", "PATCH recruitment"]],
    ["scripts/qa/tenant-table-rows/write/platform.mjs",
      ["POST delegations", "POST it-operations", "PATCH it-operations", "PATCH compliance/data-requests", "POST approval-chains", "POST integration-connectors"]],
    ["scripts/qa/tenant-table-rows/write/performance.mjs",
      ["POST performance/action-items", "PATCH performance/action-items", "PATCH performance/continuous"]],
  ];
  let credited = 0;
  for (const [rowFile, keys] of families) {
    const lines = readFileSync(rowFile, "utf8").split("\n");
    const run = rowFile.endsWith("/performance.mjs")
      ? "run 40192690047 head 296ca9582d34f44b088f759d1506eccb5f60773e"
      : "run 40200060037 head 1fd16ee304a896072560fd86ff06915e7bce159c";
    for (const key of keys) {
      const [verb, route] = key.split(" ");
      const method = manifest.allApiRouteFiles["src/app/api/" + route + "/route.ts"]?.methods.find(m => m.name === verb);
      assert.equal(method?.status, "COVERED", key + ": independent proof credit must be preserved");
      assert.equal(method.testedBy?.file, "scripts/qa/tenant-write-table-http.mjs", key);
      assert.equal(method.testedBy.rowFile, rowFile, key);
      assert.ok(lines[method.testedBy.rowLine - 1]?.includes('key: "' + key + '"'), key + ": source line must identify this method");
      assert.ok(method.reason.includes(run) && method.testedBy.evidence.includes(run), key + ": historical execution evidence must be kept");
      assert.equal(method.testedBy.ownPositiveLine, 112, key);
      assert.equal(method.testedBy.foreignDenialLine, 125, key);
      assert.equal(method.testedBy.unchangedDbLine, 149, key);
      credited++;
    }
  }
  assert.equal(credited, 14);
  const worksite = manifest.allApiRouteFiles["src/app/api/workforce/worksites/route.ts"].methods.find(m => m.name === "POST");
  assert.equal(worksite.status, "GAP", "create_worksite alone cannot certify the whole POST handler");
  assert.equal(worksite.testedBy, null, "no method-level credit for a partially exercised handler");
  assert.match(worksite.reason, /create_worksite/);
});

test("ESS overview records match the merged, source-pinned method-level manifest", () => {
  const overview = readFileSync("docs/engineering/tenant-isolation-coverage-inventory.md", "utf8").split("\n");
  const route = manifest.allApiRouteFiles["src/app/api/self/contribution-issues/route.ts"];
  for (const name of ["GET", "POST"]) {
    const method = route.methods.find(m => m.name === name);
    assert.equal(method.status, "COVERED", name + ": the two executed ESS cases are provisionally credited");
    assert.equal(method.testedBy?.file, "scripts/qa/tenant-ess-statutory-identity-http.mjs");
    const quote = String.fromCharCode(96);
    const rows = overview.filter(line => line.startsWith("| [" + quote + "self/contribution-issues" + quote + " " + name + "]("));
    assert.equal(rows.length, 1, name + ": overview must have one current-source method row");
    assert.ok(rows[0].includes("route.ts#L" + method.line), name + ": route line must match manifest");
    assert.ok(rows[0].includes("tenant-ess-statutory-identity-http.mjs#L" + method.testedBy.ownPositiveLine),
      name + ": overview must cite the exact executed own HTTP proof");
    assert.ok(rows[0].endsWith("| **COVERED** |"), name + ": overview must not claim GAP for an evidenced method");
    assert.ok(!rows[0].includes("NO VALID METHOD PROOF"), name);
  }
  assert.ok(overview.includes("| gap | " + manifest.metrics.gap + " |"));
  assert.ok(overview.includes("| coveredAfter | " + manifest.metrics.coveredAfter + " |"));
});

test("labor-costing GET-only source repin does not certify the legacy POST", () => {
  const file = "src/app/api/workforce/labor-costing/route.ts";
  // Compare with the immutable pre-GET-hardening source, not the moving
  // merge-base or main branch (which now contains the reviewed GET change).
  const originalSourceRef = "de6d0fb597d25e1af3db68dfe1f4884353c1916c";
  const baseline = JSON.parse(execFileSync("git", ["show", originalSourceRef + ":" + manifestFile], {
    encoding: "utf8", maxBuffer: 32 << 20,
  }));
  const old = baseline.allApiRouteFiles[file];
  const current = manifest.allApiRouteFiles[file];
  assert.equal(old.gitBlobSha, "e5e2c007ca41da3c6e2fc1217600f83640f48975",
    "Historical comparator must remain the original labor-costing source");
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
