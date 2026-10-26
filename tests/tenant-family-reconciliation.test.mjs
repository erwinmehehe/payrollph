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

// #1402 adds independently exercised People/platform and Performance methods after
// main's #1423 reconciliation. They have distinct, already source-pinned PG16/HTTP
// receipts and must not be mistaken for unreviewed promotions of #1423's held rows.
const independentlyProvenWrites = new Map([
  ...["PATCH discipline", "PATCH provisioning", "POST dynamic-worker-groups", "POST recruitment", "PATCH recruitment"]
    .map(key => [key, "scripts/qa/tenant-table-rows/write/people.mjs"]),
  ...["POST delegations", "POST it-operations", "PATCH it-operations",
    "PATCH compliance/data-requests", "POST approval-chains", "POST integration-connectors"]
    .map(key => [key, "scripts/qa/tenant-table-rows/write/platform.mjs"]),
  ...["POST performance/action-items", "PATCH performance/action-items", "PATCH performance/continuous"]
    .map(key => [key, "scripts/qa/tenant-table-rows/write/performance.mjs"]),
]);
const peoplePlatformReceipt = "run 40200060037 head 1fd16ee304a896072560fd86ff06915e7bce159c";
const performanceReceipt = "run 40192690047 head 296ca9582d34f44b088f759d1506eccb5f60773e";
// Three previously credited rows moved when the People/platform family was extended.
// Review their exact catalog declaration rather than allowing arbitrary row-pin drift.
const reviewedRowMoves = new Map([["PATCH delegations", 24], ["POST discipline", 23], ["PATCH tenant-modules", 37]]);

test("selection is idempotent and preserves #1423 and independent #1402 proof ownership", () => {
  const before = readFileSync(manifestFile, "utf8");
  const output = JSON.parse(execFileSync(process.execPath, ["scripts/qa/tenant-table-credit.mjs", "--reconcile-merged-families", "--check"], { encoding: "utf8" }));
  assert.equal(output.newlyCredited, 0);
  assert.deepEqual(output.before, output.after);
  assert.equal(readFileSync(manifestFile, "utf8"), before);

  const baseRef = process.env.FAIL_CLOSED_GUARD_BASE_REF || "origin/main";
  const base = JSON.parse(execFileSync("git", ["show", baseRef + ":" + manifestFile], { encoding: "utf8", maxBuffer: 32 << 20 }));
  const selected = new Set(receipt.accepted.map(row => row.key));
  const moved = new Map();
  const sourceLines = file => {
    if (!moved.has(file)) moved.set(file, readFileSync(file, "utf8").split("\n"));
    return moved.get(file);
  };
  const verifyRowPin = (method, key) => {
    const proof = method.testedBy;
    const declaration = sourceLines(proof.rowFile)[proof.rowLine - 1];
    assert.ok(declaration?.includes('key: "' + key + '"'), key + ": exact family declaration is required");
  };

  const changed = [];
  for (const [file, entry] of Object.entries(base.allApiRouteFiles)) for (const method of entry.methods) {
    const now = manifest.allApiRouteFiles[file].methods.find(item => item.name === method.name);
    const key = method.name + " " + entry.route;
    assert.ok(now, key + ": method removed without re-inventory");

    if (selected.has(key)) {
      assert.deepEqual(now, method, key + ": the three reviewed #1423 credits must retain their exact provenance");
      continue;
    }

    const independentSource = independentlyProvenWrites.get(key);
    if (independentSource) {
      assert.equal(method.status, "GAP", key + ": previously credited main method cannot be credited again");
      assert.equal(method.testedBy, null, key + ": expected a formerly unproven method");
      assert.equal(now.status, "COVERED", key + ": independently executed method must retain its credit");
      assert.equal(now.testedBy?.file, "scripts/qa/tenant-write-table-http.mjs", key);
      assert.equal(now.testedBy?.rowFile, independentSource, key + ": original proof family must be preserved");
      const run = independentSource.endsWith("/performance.mjs") ? performanceReceipt : peoplePlatformReceipt;
      assert.ok(now.reason.includes(run) && now.testedBy.evidence.includes(run),
        key + ": preserve the independently executed HTTP/PostgreSQL receipt");
      assert.equal(now.testedBy.ownPositiveLine, 112, key);
      assert.equal(now.testedBy.foreignDenialLine, 125, key);
      assert.equal(now.testedBy.unchangedDbLine, 149, key);
      verifyRowPin(now, key);
      changed.push(key);
      continue;
    }

    if (key === "POST workforce/worksites") {
      assert.equal(method.status, "GAP");
      assert.equal(now.status, "GAP", "action-only worksite evidence cannot certify the whole POST method");
      assert.equal(now.testedBy, null, "incomplete worksite action cannot acquire a method-level proof");
      assert.match(now.reason, /create_worksite/);
      assert.match(now.reason, /run 40200060037, head 1fd16ee304a896072560fd86ff06915e7bce159c/);
      continue;
    }

    assert.equal(now.status, method.status, key + ": unrelated method coverage must not change");
    if (JSON.stringify(now) === JSON.stringify(method)) continue;

    // The older #1393 run refreshed labels for already-COVERED read/write rows,
    // without changing the execution, tenant scope, route, or proof ownership.
    // Restore only the allowed provenance labels before checking full equality.
    assert.equal(now.status, "COVERED", key + ": only previously covered rows may refresh their labels");
    assert.ok(now.testedBy && method.testedBy, key + ": source-pinned evidence cannot disappear");
    assert.ok(now.reason.includes(performanceReceipt) && now.testedBy.evidence.includes(performanceReceipt),
      key + ": refresh must identify the existing exact-head PG16 HTTP receipt");
    verifyRowPin(now, key);
    const original = structuredClone(now);
    original.reason = method.reason;
    original.testedBy.evidence = method.testedBy.evidence;
    if (reviewedRowMoves.has(key)) {
      assert.equal(now.testedBy.rowLine, reviewedRowMoves.get(key), key + ": only the reviewed line move is allowed");
      original.testedBy.rowLine = method.testedBy.rowLine;
    }
    assert.deepEqual(original, method, key + ": unrelated proof ownership, scope and status must be preserved");
  }

  // A separate PR cannot grant #1423's held methods, or quietly add another
  // COVERED method outside these exact fourteen previously executed scenarios.
  assert.deepEqual(changed.sort(), [...independentlyProvenWrites.keys()].sort());
  assert.equal(manifest.allApiRouteFiles["src/app/api/workforce/worksites/route.ts"]
    .methods.find(method => method.name === "POST").status, "GAP");
});
