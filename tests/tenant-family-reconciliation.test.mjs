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
    if (!selected.has(key)) {
      if (file === "src/app/api/workforce/labor-costing/route.ts") {
        // This PR hardens only GET. Re-pinning line numbers and annotating the
        // byte-identical legacy POST is not a new proof or change in ownership.
        // All other methods below still require exact full-object equality.
        assert.equal(manifest.allApiRouteFiles[file].gitBlobSha, "4b98d27a02ccd6fbfb76ad08cb501410a8fd67bd",
          "Only the exact reviewed GET-only route change may shift method lines");
        if (method.name === "GET") {
          assert.equal(method.line, 78);
          assert.equal(now.line, 79);
          assert.deepEqual({ ...now, line: method.line }, method,
            "GET must preserve every existing own/foreign source proof and scope");
        } else if (method.name === "POST") {
          assert.equal(method.line, 133);
          assert.equal(now.line, 156);
          assert.equal(now.status, "GAP", "unchanged POST must not receive GET proof credit");
          assert.equal(now.testedBy, null, "untested POST must have no certification");
          const { reviewedUncertified, ...methodWithoutReview } = now;
          assert.deepEqual({ ...methodWithoutReview, line: method.line, reason: method.reason }, method,
            "POST must retain its original method identity, GAP and empty proof");
          assert.deepEqual(reviewedUncertified, {
            kind: "unchanged-POST-in-GET-only-security-fix",
            originalRouteBlobSha: "e5e2c007ca41da3c6e2fc1217600f83640f48975",
            routeBlobSha: "4b98d27a02ccd6fbfb76ad08cb501410a8fd67bd",
            unchangedPostBlobSha: "91bcb6ee054c538f72d65630cc89deb641cfa7f5",
            reason: "Only GET and an import changed; POST bytes are independently pinned and retain GAP/zero coverage credit. Real HTTP POST proof and independent review are still required.",
          }, "POST exception cannot be broadened, changed or reused");
          assert.equal(now.reason,
            "GET-only authorization hardening; this POST body remains byte-identical to original route SHA e5e2c007ca41da3c6e2fc1217600f83640f48975. POST is still GAP: no independent owned-success plus real foreign denial and unchanged victim database evidence has been credited.");
        } else {
          assert.fail("Unexpected method in the reviewed labor-costing route: " + method.name);
        }
      } else {
        assert.deepEqual(now, method, key + ": existing proof ownership/scope/status must be preserved");
      }
    }
  }
  const newlyEligible = receipt.accepted.map(row => row.key).filter(key => {
    const [verb, route] = key.split(" ");
    return base.allApiRouteFiles["src/app/api/" + route + "/route.ts"].methods.find(method => method.name === verb).status === "GAP";
  });
  assert.deepEqual(changed.sort(), newlyEligible.sort());
});
