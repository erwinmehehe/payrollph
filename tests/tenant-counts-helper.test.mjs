import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { assertLiveTenantCounts, tallyTenantManifest } from "./helpers/tenant-counts.mjs";

function manifestOf(routes) {
  const allApiRouteFiles = {};
  for (const [path, methods] of Object.entries(routes)) {
    allApiRouteFiles[path] = { route: path, methods: Object.entries(methods).map(([name, status]) => ({ name, status })) };
  }
  const t = tallyTenantManifest({ allApiRouteFiles });
  return {
    allApiRouteFiles,
    metrics: { routeFiles: t.routeFiles, methods: t.methods, coveredAfter: t.coveredAfter, publicByDesign: t.publicByDesign, gap: t.gap },
    acceptanceStatus: "NOT ACCEPTED: " + t.gap + " API methods remain.",
  };
}
const base = (routes) => ({ ref: "synthetic-base", manifest: manifestOf(routes) });
const BASE = base({ a: { GET: "COVERED", POST: "GAP" }, b: { GET: "GAP" }, c: { GET: "PUBLIC-BY-DESIGN" } });

test("closing a GAP and adding a covered route both pass", () => {
  assertLiveTenantCounts(assert, manifestOf({ a: { GET: "COVERED", POST: "COVERED" }, b: { GET: "GAP" }, c: { GET: "PUBLIC-BY-DESIGN" } }), {}, BASE);
  assertLiveTenantCounts(assert, manifestOf({ a: { GET: "COVERED", POST: "GAP" }, b: { GET: "GAP" }, c: { GET: "PUBLIC-BY-DESIGN" }, d: { GET: "COVERED" } }), {}, BASE);
});

test("a downgraded proof, a vanished method or a new GAP fail", () => {
  assert.throws(() => assertLiveTenantCounts(assert, manifestOf({ a: { GET: "GAP", POST: "GAP" }, b: { GET: "GAP" }, c: { GET: "PUBLIC-BY-DESIGN" } }), {}, BASE), /downgraded/);
  assert.throws(() => assertLiveTenantCounts(assert, manifestOf({ a: { POST: "GAP" }, b: { GET: "GAP" }, c: { GET: "PUBLIC-BY-DESIGN" } }), {}, BASE), /disappeared/);
  assert.throws(() => assertLiveTenantCounts(assert, manifestOf({ a: { GET: "COVERED", POST: "GAP" }, b: { GET: "GAP" }, c: { GET: "PUBLIC-BY-DESIGN" }, d: { GET: "GAP" } }), {}, BASE), /GAP never rises/);
});

test("removing a whole route file is allowed; metrics or headline drift fail", () => {
  assertLiveTenantCounts(assert, manifestOf({ a: { GET: "COVERED", POST: "GAP" }, c: { GET: "PUBLIC-BY-DESIGN" } }), {}, BASE);
  const drift = manifestOf({ a: { GET: "COVERED", POST: "GAP" }, b: { GET: "GAP" }, c: { GET: "PUBLIC-BY-DESIGN" } });
  drift.metrics.gap += 1;
  assert.throws(() => assertLiveTenantCounts(assert, drift, {}, BASE), /metrics\.gap/);
  const headline = manifestOf({ a: { GET: "COVERED", POST: "GAP" }, b: { GET: "GAP" }, c: { GET: "PUBLIC-BY-DESIGN" } });
  headline.acceptanceStatus = "NOT ACCEPTED: 999 API methods remain.";
  assert.throws(() => assertLiveTenantCounts(assert, headline, {}, BASE), /headline/);
});

test("a CI job that names a base must be able to read it", () => {
  const live = manifestOf({ a: { GET: "COVERED" } });
  assert.throws(() => assertLiveTenantCounts(assert, live, { CI: "true", FAIL_CLOSED_GUARD_BASE_REF: "deadbeef" }, null), /base manifest must be readable/);
  assertLiveTenantCounts(assert, live, {}, null);
});

test("the real manifest satisfies the invariants against its base", () => {
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  assertLiveTenantCounts(assert, manifest);
});

test("no tenant test pins live coverage numbers again", () => {
  // Frozen baselines (the 406-method closure queue) are intentional; live metrics are not.
  const pinned = /metrics\.(gap|coveredAfter|methods|publicByDesign|routeFiles)\b[^;\n]*(?:,|===|!==)\s*\d{2,}|NOT ACCEPTED: \d+ API methods|\| (?:gap|coveredAfter|publicByDesign) \| \d{2,} \|/;
  const offenders = readdirSync("tests")
    .filter((name) => /\.test\.(ts|mjs)$/.test(name) && name !== "tenant-counts-helper.test.mjs")
    .filter((name) => pinned.test(readFileSync("tests/" + name, "utf8")));
  assert.deepEqual(offenders, [], "use assertLiveTenantCounts() instead of pinning live counts");
});
