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
import { YEAR_END_HOLD_KIND, YEAR_END_HOLD_REASON, YEAR_END_PROOF, YEAR_END_SOURCE_PINS, yearEndHoldRecord } from "../../scripts/qa/tenant-year-end-credit.mjs";
import { verifyOracleSourceHolds,verifiedOracleRenewalKeys } from "../../scripts/qa/payroll-run-oracle-hold.mjs";
import { OIDC_CALLBACK, verifyOidcCallbackHold } from "../../scripts/qa/tenant-oidc-source-supersession.mjs";

/** Newly restored methods only, backed by the sealed executed renewal. */
export function oracleRenewalDelta(before,current){
  return [...verifiedOracleRenewalKeys(current)].filter(key=>{
    const at=key.indexOf(' '),verb=key.slice(0,at),path=key.slice(at+1);
    return before.allApiRouteFiles[path]?.methods.find(row=>row.name===verb)?.status==='GAP';
  }).length;
}

/** Count only the sealed oracle withdrawals newly introduced over this base. */
export function oracleWithdrawalDelta(before, current) {
  const held = verifyOracleSourceHolds(current, before);
  return [...held].filter(key => {
    const at = key.indexOf(" "), verb = key.slice(0, at), path = key.slice(at + 1);
    return before.allApiRouteFiles[path]?.methods.find(row => row.name === verb)?.status === "COVERED";
  }).length;
}

const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const RANK = { GAP: 0, "PUBLIC-BY-DESIGN": 1, "PRIVILEGED-OPERATIONS-TOKEN-ONLY": 1, COVERED: 1 };

export function tallyTenantManifest(manifest) {
  const methods = Object.entries(manifest.allApiRouteFiles).flatMap(([path, file]) =>
    file.methods.map((method) => ({ key: method.name + " " + path, status: method.status, path })));
  const count = (status) => methods.filter((m) => m.status === status).length;
  return {
    routeFiles: Object.keys(manifest.allApiRouteFiles).length,
    methods: methods.length,
    coveredAfter: count("COVERED"),
    publicByDesign: count("PUBLIC-BY-DESIGN"),
    privilegedOperationsTokenOnly: count("PRIVILEGED-OPERATIONS-TOKEN-ONLY"),
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
  const oldSha = "7572c6111cf40d398b3cc8c1f940efd0a9b8d362";
  const atomicOnlySha = "e4741d98c23e068f4ecd7032e172ce60b95852cf";
  const employerJoinedSha = "f040f5bbbc3df275d32d23f1728b1b0345f77814";
  const before = beforeManifest.allApiRouteFiles?.[file];
  const after = liveManifest.allApiRouteFiles?.[file];
  const none = new Set();
  const newSha = after?.gitBlobSha;
  if (before?.gitBlobSha !== oldSha ||
      (newSha !== atomicOnlySha && newSha !== employerJoinedSha) ||
      before.methods?.length !== 2 || after.methods?.length !== 2) return none;
  const expected = {
    "kind": "year-end-binding-atomic-source-only-zero-credit",
    "priorRouteBlobSha": "7572c6111cf40d398b3cc8c1f940efd0a9b8d362",
    "routeBlobSha": newSha,
    "contractFile": "tests/year-end-binding-transaction-contract.test.mjs",
    "contractBlobSha": "9562442c4d9e7d820027630cead6d753c0fc3767",
    "annualizationBlobSha": "7194658c42b9ef33c84acd84ab356c28c6303883",
    "queueBlobSha": "961cfb5535063a9683b04dbd5260c2a9730ffd66",
    "currentQueueBlobSha": "dc5719a2c34094b5449bf4ecacb198ab0d74a313",
    "queueSourceChange": "Work-date anchor only; no inherited year-end source credit or financial acceptance",
    "credits": 0,
    "actualPg16Http": "PENDING",
    "independentSecurityReview": "PENDING",
    "productionCertified": false
};
  // These are the ONLY recognized revisions: #1744 atomic binding and
  // #1797's employer-matched GET join. Both retain zero accepted HTTP credits.
  const reason = newSha === employerJoinedSha
    ? "Still GAP: #1744 updated the financial binding source; this draft adds an employer-matched employee join and exact-source fictional PG16 proof candidates for the full GET and POST methods. No method credit or independent payroll/security review yet."
    : "Previously credited by #1730 against the old route Git blob; revised #1744 GET/POST source has no independently accepted exact-source method proof. GAP and zero current credits pending owner/security review.";
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
      ["src/lib/payroll-engine.ts", expected.currentQueueBlobSha],
    ]) if (sha(readFileSync(filePath, "utf8")) !== expectedSha) return none;
  } catch { return none; }
  return new Set(["GET " + file, "POST " + file]);
}

/**
 * The exact #1804 year-end receipts may be withdrawn to a zero-credit hold when src/lib/year-end.ts changes
 * (the proof ran against the previous annualization source). Only the recorded receipt, the exact reason and the
 * exact hold record for the current source on disk qualify; this grants no credit and no other downgrade.
 */
function yearEndAnnualizationSourceHold(beforeManifest, liveManifest) {
  const file = "src/app/api/year-end/route.ts";
  const before = beforeManifest.allApiRouteFiles?.[file];
  const after = liveManifest.allApiRouteFiles?.[file];
  const none = new Set();
  if (!before || !after || before.methods?.length !== 2 || after.methods?.length !== 2 ||
      before.gitBlobSha !== after.gitBlobSha) return none;
  const sha = bytes => createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
  let annualization;
  try { annualization = sha(readFileSync("src/lib/year-end.ts")); } catch { return none; }
  if (annualization === YEAR_END_SOURCE_PINS["src/lib/year-end.ts"]) return none;
  for (const verb of ["GET", "POST"]) {
    const prior = before.methods.find(m => m.name === verb);
    const current = after.methods.find(m => m.name === verb);
    const proof = prior?.testedBy;
    if (prior?.status !== "COVERED" || proof?.proofPullRequest !== 1804 ||
        proof?.verifiedPrHeadSha !== YEAR_END_PROOF.head ||
        proof?.workflowRunId !== YEAR_END_PROOF.run ||
        current?.status !== "GAP" || current.testedBy !== null ||
        current.reason !== YEAR_END_HOLD_REASON ||
        current.reviewedUncertified?.kind !== YEAR_END_HOLD_KIND ||
        JSON.stringify(current.reviewedUncertified) !== JSON.stringify(yearEndHoldRecord(after.gitBlobSha, annualization))) return none;
  }
  return new Set(["GET " + file, "POST " + file]);
}

/**
 * Only Worker 360's exact previously credited GET may be demoted when the
 * new legal-employer source makes its historic parent-employer receipt stale.
 * The new source, historical receipt and zero-credit hold must all match.
 * This NEVER permits a generic downgrade or a credit transfer.
 */
export function reviewedWorker360LegalEmployerSupersession(beforeManifest, liveManifest) {
  const file = "src/app/api/hcm/worker-360/route.ts";
  const oldSha = "78874e3800c9648b2e9e8895a4c0f1b2db9e2e62";
  const newSha = "19875021d750b722fc69e0fe939e57928a158af9";
  const oldPageSha = "337034f839c17a30077e2cfe5991c640e0c6a5e9";
  const newPageSha = "3b506b27e0af73ec370c448c6a0ad02a80c8f75c";
  const before = beforeManifest.allApiRouteFiles?.[file];
  const after = liveManifest.allApiRouteFiles?.[file];
  const oldPage = beforeManifest.scopedPages?.find(e => e.path === "src/app/hcm/worker-360/page.tsx");
  const newPage = liveManifest.scopedPages?.find(e => e.path === "src/app/hcm/worker-360/page.tsx");
  const prior = before?.methods?.find(e => e.name === "GET");
  const current = after?.methods?.find(e => e.name === "GET");
  const hold = current?.reviewedUncertified;
  if (before?.gitBlobSha !== oldSha || after?.gitBlobSha !== newSha ||
      before?.methods?.length !== 1 || after?.methods?.length !== 1 ||
      prior?.status !== "COVERED" || current?.status !== "GAP" ||
      current.testedBy !== null ||
      hold?.kind !== "worker360-legal-employer-source-supersession-zero-credit" ||
      hold?.oldSourceBlobSha !== oldSha || hold?.newSourceBlobSha !== newSha ||
      JSON.stringify(hold.historicalProof) !== JSON.stringify(prior.testedBy) ||
      hold.exactHeadPg16Http !== "PENDING" ||
      hold.independentSecurityReview !== "PENDING" ||
      hold.productionCertified !== false || hold.coverageCredits !== 0 ||
      oldPage?.blob !== oldPageSha || oldPage.status !== "COVERED" ||
      newPage?.blob !== newPageSha || newPage.status !== "GAP" ||
      newPage.testedBy !== undefined ||
      newPage.reviewedUncertified?.kind !== hold.kind ||
      newPage.reviewedUncertified?.coverageCredits !== 0 ||
      newPage.reviewedUncertified?.independentSecurityReview !== "PENDING" ||
      newPage.reviewedUncertified?.productionCertified !== false) return new Set();
  const sha = source => {
    const b = Buffer.from(source, "utf8");
    return createHash("sha1").update("blob " + b.length + "\0").update(b).digest("hex");
  };
  try {
    if (sha(readFileSync(file, "utf8")) !== newSha ||
        sha(readFileSync("src/app/hcm/worker-360/page.tsx", "utf8")) !== newPageSha)
      return new Set();
  } catch { return new Set(); }
  return new Set(["GET " + file]);
}

/** Exactly one previously credited callback may be withdrawn after this
 * default-OFF source change. No other OIDC or tenant-method downgrade is allowed. */
export function reviewedOidcSourceSupersession(beforeManifest, liveManifest) {
  const old = beforeManifest.allApiRouteFiles?.[OIDC_CALLBACK];
  const now = liveManifest.allApiRouteFiles?.[OIDC_CALLBACK];
  const prior = old?.methods?.find(row => row.name === "GET");
  const proof = prior?.testedBy;
  if (old?.gitBlobSha !== "a27d855a81751498cc907134e8e9dde7400c9f58" ||
      old.methods.length !== 1 || prior?.status !== "COVERED" ||
      prior.reviewedUncertified !== undefined ||
      proof?.file !== "scripts/qa/tenant-oidc-full-http.mjs" ||
      proof.routeBlobSha !== old.gitBlobSha ||
      proof.sourceHead !== "d46ed24b239b47a2182b868f399f3cbb1d706ca0" ||
      proof.workflowRunId !== 43251981343 || proof.workflowJobId !== 131299924274 ||
      proof.independentlyAccepted !== false || proof.independentSecurityReview !== "PENDING" ||
      proof.productionCertified !== false ||
      now?.gitBlobSha !== "9cb02f681ae8128c8b9c661b057c5591891bdc9e" ||
      now.methods?.length !== 1) return new Set();
  verifyOidcCallbackHold(liveManifest);
  return new Set(["GET " + OIDC_CALLBACK]);
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
  for (const key of ["routeFiles", "methods", "coveredAfter", "publicByDesign", "privilegedOperationsTokenOnly", "gap"]) {
    // Historical main inventories predate the explicit token-only classification.
    // They are valid only if *no* API method has that status. A manifest opting
    // into the new class must always publish and match its exact count.
    if (key === "privilegedOperationsTokenOnly" && !Object.hasOwn(manifest.metrics, key)) {
      assert.equal(live.privilegedOperationsTokenOnly, 0,
        "Legacy manifest cannot silently contain token-only methods");
      continue;
    }
    assert.equal(manifest.metrics[key], live[key], "manifest metrics." + key + " must equal the actual per-method tally");
  }
  assert.equal(live.coveredAfter + live.publicByDesign + live.privilegedOperationsTokenOnly + live.gap, live.methods, "every method has exactly one status");
  assert.ok(String(manifest.acceptanceStatus).startsWith("NOT ACCEPTED: " + live.gap + " API methods"),
    "the acceptance headline must quote the live GAP count");

  const base = injectedBase === undefined ? baseTenantManifest(env) : injectedBase;
  if (!base) {
    // A CI job that names a base must be able to read it; never skip silently there.
    assert.ok(!(env.CI === "true" && env.FAIL_CLOSED_GUARD_BASE_REF), "the CI base manifest must be readable");
    return { live, base: null };
  }
  const before = tallyTenantManifest(base.manifest);
  const explicitlySuperseded = new Set([
    ...reviewedYearEndSourceSupersession(base.manifest, manifest),
    ...yearEndAnnualizationSourceHold(base.manifest, manifest),
    ...reviewedWorker360LegalEmployerSupersession(base.manifest, manifest),
    ...reviewedOidcSourceSupersession(base.manifest, manifest),
    ...verifyOracleSourceHolds(manifest, base.manifest),
  ]);
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
    "COVERED never drops except exact reviewed source supersessions (base " + base.ref + ")");
  assert.ok(live.gap - explicitlySuperseded.size <= before.gap,
    "GAP never rises except exact reviewed source supersessions (base " + base.ref + ")");
  return { live, base: before };
}
