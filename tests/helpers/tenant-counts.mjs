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
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

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


/**
 * Only the two previously provisional #1730 year-end receipts may be revoked
 * after the exact reviewed route rewrite. This invalidates old source proof;
 * it grants NO new credits, rollout authority, or generalized downgrade.
 */
function reviewedYearEndSourceSupersession(beforeManifest, liveManifest) {
  const file = "src/app/api/year-end/route.ts";
  const oldSha = "7572c6111cf40d398b3cc8c1f940efd0a9b8d362", newSha = "e4741d98c23e068f4ecd7032e172ce60b95852cf";
  const before = beforeManifest.allApiRouteFiles?.[file];
  const after = liveManifest.allApiRouteFiles?.[file];
  const none = new Set();
  if (before?.gitBlobSha !== oldSha || after?.gitBlobSha !== newSha ||
      before.methods?.length !== 2 || after.methods?.length !== 2) return none;
  const expected = {
    "kind": "year-end-binding-atomic-source-only-zero-credit",
    "priorRouteBlobSha": "7572c6111cf40d398b3cc8c1f940efd0a9b8d362",
    "routeBlobSha": "e4741d98c23e068f4ecd7032e172ce60b95852cf",
    "contractFile": "tests/year-end-binding-transaction-contract.test.mjs",
    "contractBlobSha": "15adc60ac6cdfa6d286ad4f4c88630b8bc2aa40f",
    "annualizationBlobSha": "d0c372cde95721ec37a8e0693ac2d2f883e12e13",
    "queueBlobSha": "961cfb5535063a9683b04dbd5260c2a9730ffd66",
    "credits": 0,
    "actualPg16Http": "PENDING",
    "independentSecurityReview": "PENDING",
    "productionCertified": false
};
  const reason = "Previously credited by #1730 against the old route Git blob; revised #1744 GET/POST source has no independently accepted exact-source method proof. GAP and zero current credits pending owner/security review.";
  const oldActions = {
    GET: ["json", "preflight", "2316", "2316-print", "alphalist"],
    POST: ["annualization", "bind-run"],
  };
  for (const verb of ["GET", "POST"]) {
    const prior = before.methods.find(m => m.name === verb);
    const current = after.methods.find(m => m.name === verb);
    const proof = prior?.testedBy;
    if (prior?.status !== "COVERED" || current?.status !== "GAP" ||
        current.testedBy !== null || current.reason !== reason ||
        JSON.stringify(current.reviewedUncertified) !== JSON.stringify(expected) ||
        proof?.routeBlobSha !== oldSha ||
        proof?.verifiedPrHeadSha !== "066c1d6b405365ff9ddacc229b8d0ce5cbc68aa5" ||
        proof?.workflowRunId !== 41446394887 ||
        proof?.proofBlobSha !== "9e64fc18a1a5b76c3ec583a0668ea680efd1ed19" ||
        proof?.workflowBlobSha !== "9e6ca6431b168e05afecc5e40a42b1973ad1f675" ||
        proof?.independentlyAccepted !== false || proof?.productionCertified !== false ||
        JSON.stringify(proof?.methodActions) !== JSON.stringify(oldActions[verb])) return none;
  }
  const sha = value => {
    const b = Buffer.from(value, "utf8");
    return createHash("sha1").update("blob " + b.length + "\0").update(b).digest("hex");
  };
  try {
    for (const [filePath, expectedSha] of [
      [file, newSha],
      [expected.contractFile, expected.contractBlobSha],
      ["src/lib/year-end.ts", expected.annualizationBlobSha],
      ["src/lib/payroll-engine.ts", expected.queueBlobSha],
    ]) if (sha(readFileSync(filePath, "utf8")) !== expectedSha) return none;
  } catch { return none; }
  return new Set(["GET " + file, "POST " + file]);
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
  const explicitlySuperseded = reviewedYearEndSourceSupersession(base.manifest, manifest);
  const regressions = [];
  for (const [key, old] of before.byKey) {
    const now = live.byKey.get(key);
    if (!now) {
      // A method may only disappear together with its whole route file.
      if (manifest.allApiRouteFiles[old.path]) regressions.push(key + " disappeared");
      continue;
    }
    if (RANK[now.status] < RANK[old.status] && !explicitlySuperseded.has(key))
      regressions.push(key + " downgraded " + old.status + " -> " + now.status);
  }
  assert.deepEqual(regressions, [], "no proven method may disappear or be downgraded (base " + base.ref + ")");
  assert.ok(live.coveredAfter + explicitlySuperseded.size >= before.coveredAfter,
    "COVERED never drops except exact two superseded #1730 year-end methods (base " + base.ref + ")");
  assert.ok(live.gap - explicitlySuperseded.size <= before.gap,
    "GAP never rises except exact two superseded #1730 year-end methods (base " + base.ref + ")");
  return { live, base: before };
}
