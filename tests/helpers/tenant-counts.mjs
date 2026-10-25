/**
 * Live tenant-isolation count invariants, shared by every proof-batch test.
 *
 * Batches used to pin exact numbers ("152 covered / 332 GAP") in a dozen tests, so any two
 * batches in flight always conflicted. What those numbers protected is invariant, not a value:
 *   1. the manifest metrics equal the actual per-method tallies and add up;
 *   2. the acceptance headline quotes the live GAP count;
 *   3. against the PR's base, no method disappears, no proven method is downgraded,
 *      COVERED never drops and GAP never rises.
 * A batch now only adds proof entries; it never edits shared numbers.
 */
import { execFileSync } from "node:child_process";

const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const RANK = { GAP: 0, "PUBLIC-BY-DESIGN": 1, COVERED: 1 };

export function tallyTenantManifest(manifest) {
  const methods = Object.entries(manifest.allApiRouteFiles).flatMap(([path, file]) =>
    file.methods.map((method) => ({ key: method.name + " " + path, status: method.status, path })));
  const count = (status) => methods.filter((m) => m.status === status).length;
  return {
    routeFiles: Object.keys(manifest.allApiRouteFiles).length,
    methods: methods.length,
    coveredAfter: count("COVERED"),
    publicByDesign: count("PUBLIC-BY-DESIGN"),
    gap: count("GAP"),
    byKey: new Map(methods.map((m) => [m.key, m])),
  };
}

/** The manifest at the PR's base, or null when no base is available outside CI. */
export function baseTenantManifest(env = process.env) {
  const refs = [env.FAIL_CLOSED_GUARD_BASE_REF, env.TENANT_COUNTS_BASE_REF, "origin/main"].filter(Boolean);
  for (const ref of refs) {
    try {
      const text = execFileSync("git", ["show", ref + ":" + MANIFEST], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
      return { ref, manifest: JSON.parse(text) };
    } catch { /* try the next ref */ }
  }
  return null;
}

export function assertLiveTenantCounts(assert, manifest, env = process.env, injectedBase = undefined) {
  const live = tallyTenantManifest(manifest);
  for (const key of ["routeFiles", "methods", "coveredAfter", "publicByDesign", "gap"]) {
    assert.equal(manifest.metrics[key], live[key], "manifest metrics." + key + " must equal the actual per-method tally");
  }
  assert.equal(live.coveredAfter + live.publicByDesign + live.gap, live.methods, "every method has exactly one status");
  assert.ok(String(manifest.acceptanceStatus).startsWith("NOT ACCEPTED: " + live.gap + " API methods"),
    "the acceptance headline must quote the live GAP count");

  const base = injectedBase === undefined ? baseTenantManifest(env) : injectedBase;
  if (!base) {
    // A CI job that names a base must be able to read it; never skip silently there.
    assert.ok(!(env.CI === "true" && env.FAIL_CLOSED_GUARD_BASE_REF), "the CI base manifest must be readable");
    return { live, base: null };
  }
  const before = tallyTenantManifest(base.manifest);
  const regressions = [];
  for (const [key, old] of before.byKey) {
    const now = live.byKey.get(key);
    if (!now) {
      // A method may only disappear together with its whole route file.
      if (manifest.allApiRouteFiles[old.path]) regressions.push(key + " disappeared");
      continue;
    }
    if (RANK[now.status] < RANK[old.status]) regressions.push(key + " downgraded " + old.status + " -> " + now.status);
  }
  assert.deepEqual(regressions, [], "no proven method may disappear or be downgraded (base " + base.ref + ")");
  assert.ok(live.coveredAfter >= before.coveredAfter, "COVERED never drops below base " + base.ref);
  assert.ok(live.gap <= before.gap, "GAP never rises above base " + base.ref);
  return { live, base: before };
}
