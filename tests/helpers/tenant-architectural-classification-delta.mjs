/** Enumerate exactly nine zero-credit architecture relabels, without weakening credit checks. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isYearEndHeld, verifyYearEndCredits, verifyYearEndHold } from "../../scripts/qa/tenant-year-end-credit.mjs";
import { reviewedWorker360LegalEmployerSupersession,reviewedOidcSourceSupersession } from "./tenant-counts.mjs";
import { verifyOracleSourceHolds } from "../../scripts/qa/payroll-run-oracle-hold.mjs";

const PUBLIC = [
  ["src/app/api/setup/route.ts", "GET"],
  ["src/app/api/setup/route.ts", "POST"],
  ["src/app/api/intake-challenge/route.ts", "POST"],
  ["src/app/api/signup/route.ts", "POST"],
  ["src/app/api/signup/resend/route.ts", "POST"],
  ["src/app/api/signup/verify/route.ts", "POST"],
  ["src/app/api/auth/saml/start/[providerId]/route.ts", "GET"],
  ["src/app/api/auth/saml/acs/[providerId]/route.ts", "POST"],
];
const WORKER = "POST src/app/api/hcm/work-items/escalate/route.ts";
const allowed = new Set(PUBLIC.map(([path, verb]) => verb + " " + path));
const sha = (path, read = readFileSync) => {
  const value = Buffer.from(read(path));
  return createHash("sha1").update("blob " + value.length + "\0").update(value).digest("hex");
};
const rows = manifest => new Map(Object.entries(manifest.allApiRouteFiles)
  .flatMap(([path, route]) => route.methods.map(method =>
    [method.name + " " + path, { path, route, method }])));

export const OWNER_APPROVAL_FILE = "docs/qa/tenant-1921-owner-approval.json";
export const OWNER_APPROVAL_BLOB = "455769a992caba1ebcaa04b0999625db6ead07ce";

/**
 * #1939 has a separate source/proof record, NOT a new owner decision.
 * The old signed #1921 label approval is immutable and scoped to old blobs.
 * This exact pending record may validate the current synthetic source only;
 * it cannot mint tenant-private coverage or authorize production.
 */
export const SIGNUP_SOURCE_REVALIDATION_FILE = "docs/qa/tenant-1939-source-review-pending.json";
const SIGNUP_SOURCE_REVALIDATION_BLOB = "aa05ae93e94a58981196564872e85031fb9632ff";
const SIGNUP_SOURCE_CHANGES = [
  { path: "src/app/api/signup/route.ts",
    old: "97d6f05372bf7b88dd46c10fa46b2e50c4b76ccc",
    now: "46fe376db0951fb9851aa52d22f0e8dcc8c9750b" },
  { path: "src/app/api/signup/resend/route.ts",
    old: "7cc8bc50eddc1ab2e17692e4d32e0058f66926c3",
    now: "c38d3b1541704899369bf4189a58a14cbf6cf1e0" },
  { path: "src/app/api/signup/verify/route.ts",
    old: "6a4315e9f34039dee5929d34269c07156d32a906",
    now: "db03e7d6ded190cfb937818b52219e1e4a87bf97" },
];
export function readPendingSignupSourceRevalidation(assert) {
  const bytes = readFileSync(SIGNUP_SOURCE_REVALIDATION_FILE);
  const actual = createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
  assert.equal(actual, SIGNUP_SOURCE_REVALIDATION_BLOB,
    "Signup source-review packet changed: renewed review required");
  const packet = JSON.parse(bytes.toString("utf8"));
  assert.equal(packet.schema, "payrollph-tenant-source-revalidation-proposal-v1");
  assert.equal(packet.pr, 1939);
  assert.equal(packet.status, "PENDING_OWNER_REVIEW", "No source self-approval");
  assert.equal(packet.reviewedSourceHead, "f0a005e4ef7a35672b5b3986556d9f2c4e1fca7e");
  assert.deepEqual(packet.proposedRuntimeSourcePins, SIGNUP_SOURCE_CHANGES,
    "No unreviewed source may borrow the current proof");
  assert.deepEqual(packet.originalClassificationApproval, {
    file: OWNER_APPROVAL_FILE, blobSha: OWNER_APPROVAL_BLOB,
    immutable: true, appliesToOriginalSourceOnly: true,
  }, "Historic decision cannot be extended to current source");
  assert.deepEqual(packet.nonclaims, {
    ownerApprovedChangedSources: false, independentSecurityReview: false,
    productionCertified: false, tenantCoveredCreditsGranted: 0,
    releaseFlagsChanged: false, productionDatabaseTouched: false, providerTraffic: false,
  }, "No new owner approval, tenant credits, certification or activation");
  assert.deepEqual(packet.preloginProof, {
    path: "scripts/qa/tenant-prelogin-http.mjs",
    blobSha: "71bf01cf03caefbb2caf6c7c23a97cb53bd636c0",
    workflowPath: ".github/workflows/tenant-prelogin-http.yml",
    workflowBlobSha: "d382490efdbf19efd0a06aa233b7181b2d7c40d8",
    passedHead: "f0a005e4ef7a35672b5b3986556d9f2c4e1fca7e",
    passedJob: "https://github.com/erwinmehehe/payrollph/actions/runs/43134412313/job/130906150181",
  }, "PG16 prelogin proof must remain source-bound");
  assert.deepEqual(packet.signupFindingProof, {
    baselineNormal: "https://github.com/erwinmehehe/payrollph/actions/runs/43134412042/job/130906149697",
    baselineInvited: "https://github.com/erwinmehehe/payrollph/actions/runs/43134412042/job/130906149291",
    currentNormal: "https://github.com/erwinmehehe/payrollph/actions/runs/43134412042/job/130908226501",
    currentInvited: "https://github.com/erwinmehehe/payrollph/actions/runs/43134412042/job/130908226506",
  }, "Both named baseline failures and fresh current passes must remain pinned");
  assert.equal(sha(packet.originalClassificationApproval.file), OWNER_APPROVAL_BLOB);
  assert.equal(sha(packet.preloginProof.path), packet.preloginProof.blobSha);
  assert.equal(sha(packet.preloginProof.workflowPath), packet.preloginProof.workflowBlobSha);
  for (const row of packet.proposedRuntimeSourcePins) {
    assert.equal(sha(row.path), row.now, "Changed signup runtime source needs new proof");
  }
  return packet;
}

/**
 * A historical main-ref review must read all three original signup blobs from
 * that same ref. A current-source review must read all three renewed blobs and
 * validate the pending proof. Reject mixed versions and injected source edits;
 * a custom reader is not automatically a historical approval.
 */
function pendingSignupProofForSource(assert, read) {
  const observed = SIGNUP_SOURCE_CHANGES.map(row => sha(row.path, read));
  const historical = SIGNUP_SOURCE_CHANGES.every((row, i) => observed[i] === row.old);
  const current = SIGNUP_SOURCE_CHANGES.every((row, i) => observed[i] === row.now);
  assert.ok(historical || current,
    "Signup review must use one exact historical or pending source set; mixed or changed source is unapproved");
  return current ? readPendingSignupSourceRevalidation(assert) : null;
}

export function readArchitecturalOwnerApproval(assert, read = readFileSync) {
  const bytes = Buffer.from(read(OWNER_APPROVAL_FILE));
  const actual = createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
  assert.equal(actual, OWNER_APPROVAL_BLOB, "Owner decision changed: require explicit scope review");
  const record = JSON.parse(bytes.toString("utf8"));
  assert.equal(record.schema, "payrollph-owner-classification-approval-v1");
  assert.equal(record.pullRequest, 1921);
  assert.equal(record.status, "APPROVED");
  assert.equal(record.ownerLogin, "erwinmehehe");
  assert.equal(record.approvedOn, "2026-11-11");
  assert.equal(record.authorization.response, "Approve the nine labels");
  assert.equal(record.authorization.notIndependentCertification, true);
  assert.deepEqual(record.scope, { newTenantCoveredCredits: 0, runtimeGuardChanges: false,
    productionActivation: false, externalProviderCalls: false, independentSecurityCertification: false });
  assert.deepEqual(record.reviewedPacket, {
    commit: "de3f8cc869d280950e1aea68c1083a33bf1e97f0",
    path: "docs/qa/tenant-1921-classification-decision.md",
    gitBlobSha: "48e6faef2567440b350f19a102ecc0110407d634",
  });
  const expected = new Map([...PUBLIC.map(([path, verb]) => [verb + " " + path, "PUBLIC-BY-DESIGN"]),
    [WORKER, "PRIVILEGED-OPERATIONS-TOKEN-ONLY"]]);
  assert.equal(record.classifications.length, 9);
  assert.deepEqual(record.classifications.map(row => row.method + " " + row.path).sort(), [...expected.keys()].sort());
  const pending = pendingSignupProofForSource(assert, read);
  for (const row of record.classifications) {
    assert.equal(row.classification, expected.get(row.method + " " + row.path));
    const sourceChange = pending?.proposedRuntimeSourcePins.find(changed => changed.path === row.path);
    if (sourceChange) {
      assert.equal(row.routeBlobSha, sourceChange.old,
        "Historic owner decision must remain bound to original reviewed bytes");
      assert.equal(sha(row.path, read), sourceChange.now,
        "Current signup source must match pending evidence; owner approval remains ungranted");
    } else {
      assert.equal(row.routeBlobSha, sha(row.path, read),
        "Owner approval cannot authorize changed route bytes");
    }
  }
  return record;
}

const YEAR_END_KEYS = new Set(["GET src/app/api/year-end/route.ts", "POST src/app/api/year-end/route.ts"]);

/**
 * Methods withdrawn from the base's credited year-end pair to the exact zero-credit hold (annualization source moved).
 * The hold itself is verified fail-closed against the files on disk; assertLiveTenantCounts pins the withdrawn receipt.
 */
export function yearEndHoldDelta(beforeManifest, afterManifest) {
  const route = "src/app/api/year-end/route.ts";
  const baseCredited = beforeManifest.allApiRouteFiles?.[route]?.methods?.every(method => method.status === "COVERED");
  if (!baseCredited || !isYearEndHeld(afterManifest)) return 0;
  verifyYearEndHold(afterManifest);
  return 2;
}

/**
 * Two year-end credits renewed by a source-matched main-only PG16 run
 * after the #1944 historical hold. Validate the precise proof, not just count.
 */
export function yearEndRenewalDelta(beforeManifest, afterManifest) {
  if (!isYearEndHeld(beforeManifest) || isYearEndHeld(afterManifest)) return 0;
  return verifyYearEndCredits(afterManifest);
}

/** Base may already contain these accepted classifications, so post-merge delta is zero. */
export function verifyArchitecturalRelabelDelta(assert, beforeManifest, afterManifest, read = readFileSync) {
  const approval = readArchitecturalOwnerApproval(assert, read);
  const pending = pendingSignupProofForSource(assert, read);
  const before = rows(beforeManifest), after = rows(afterManifest);
  const retiredWorkerCredit = reviewedWorker360LegalEmployerSupersession(beforeManifest, afterManifest);
  const retiredOidcCredit = reviewedOidcSourceSupersession(beforeManifest, afterManifest);
  const oracleHolds = verifyOracleSourceHolds(afterManifest, beforeManifest);
  const changes = { gapRelabels: 0, publicByDesign: 0, privilegedTokenOnly: 0 };
  for (const [key, old] of before) {
    const current = after.get(key);
    assert.ok(current, "API method disappeared: " + key);
    // Exact source withdrawals are neither public classifications nor credits.
    if (old.method.status === "COVERED" && current.method.status === "GAP" && oracleHolds.has(key)) continue;
    if (YEAR_END_KEYS.has(key) && old.method.status === "COVERED" && current.method.status === "GAP" && yearEndHoldDelta(beforeManifest, afterManifest) === 2) continue;
    const target = allowed.has(key) ? "PUBLIC-BY-DESIGN"
      : key === WORKER ? "PRIVILEGED-OPERATIONS-TOKEN-ONLY" : null;
    if (target) assert.notEqual(current.method.status, "COVERED", "Classification cannot grant a tenant-private credit: " + key);
    if (!target || current.method.status !== target) {
      if (current.method.status === old.method.status || current.method.status === "COVERED") continue;
      // This exact source-sealed retirement is not an owner classification or
      // a new credit; all other downgrades still fail the existing check.
      if (!target && (retiredWorkerCredit.has(key)||retiredOidcCredit.has(key))) continue;
      assert.equal(old.method.status, "GAP", "Unapproved status downgrade: " + key);
    }
    assert.ok(target, "No unrelated GAP may disappear: " + key);
    assert.equal(current.method.status, target, "Wrong architecture classification: " + key);
    assert.ok(old.method.status === "GAP" || old.method.status === target, "Unapproved classification replacement: " + key);
    const sourceChange = pending?.proposedRuntimeSourcePins.find(row => row.path === current.path);
    if (sourceChange) {
      assert.ok([sourceChange.old, sourceChange.now].includes(old.route.gitBlobSha),
        "Historic or re-inventoried base signup blob required: " + key);
      assert.equal(current.route.gitBlobSha, sourceChange.now,
        "Exact current signup source required: " + key);
    } else {
      assert.equal(current.route.gitBlobSha, old.route.gitBlobSha, "Route bytes changed: " + key);
    }
    assert.equal(current.route.gitBlobSha, sha(current.path, read), "Source pin drift: " + key);
    assert.equal(current.method.testedBy, null, "No tenant-private proof credit: " + key);
    if (target === "PUBLIC-BY-DESIGN") {
      const evidence = current.method.classificationEvidence;
      assert.equal(evidence?.sourceBlobSha, current.route.gitBlobSha, key);
      assert.equal(evidence?.methodCoverageCredits, 0, key);
      assert.equal(evidence?.independentSecurityReview, "PENDING", key);
      assert.equal(evidence?.productionCertified, false, key);
      assert.equal(evidence?.classificationApproval, "OWNER_APPROVED", key);
      assert.equal(evidence?.approvedOn, approval.approvedOn, "Approval date must match the recorded owner decision");
      assert.deepEqual(evidence?.ownerApprovalRecord, { file: OWNER_APPROVAL_FILE, blobSha: OWNER_APPROVAL_BLOB }, key);
      assert.equal(evidence?.evidenceLabel, "SOLO_VERIFIED_DEV_RECOVERY", key);
      if (key.includes("/auth/saml/")) {
        assert.equal(evidence.category, "disabled-public-SAML-uniform-refusal", key);
        assert.equal(evidence.activeSamlLoginProven, false, key);
        assert.equal(evidence.mergedPr, 1896, key);
        assert.equal(evidence.boundaryFile, "src/lib/saml-disabled-boundary.ts", key);
        assert.equal(evidence.boundaryBlobSha, "ad19ba4fb718fddd9826df15f7740f482b795ad7", key);
        assert.equal(evidence.boundaryBlobSha, sha(evidence.boundaryFile, read), key);
        assert.equal(evidence.testFile, "tests/tenant-saml-disabled-boundary.test.ts", key);
        assert.equal(evidence.testBlobSha, "9afd5c6ec0c499b394d498ed6211d84e5f787e4b", key);
        assert.equal(evidence.testBlobSha, sha(evidence.testFile, read), key);
      } else {
        assert.equal(evidence.category, "public-prelogin-source-and-PG16", key);
        assert.equal(evidence.proofFile, "scripts/qa/tenant-prelogin-http.mjs", key);
        assert.equal(evidence.proofBlobSha, pending ? "71bf01cf03caefbb2caf6c7c23a97cb53bd636c0" : "1cd04c46ae9df3e2291df8f810917d98a59ef841", key);
        assert.equal(evidence.proofBlobSha, sha(evidence.proofFile, read), key);
        assert.equal(evidence.workflowFile, ".github/workflows/tenant-prelogin-http.yml", key);
        assert.equal(evidence.workflowBlobSha, pending ? "d382490efdbf19efd0a06aa233b7181b2d7c40d8" : "b452bbaa93639778142d9bffcc934d7ad554eb60", key);
        assert.equal(evidence.workflowBlobSha, sha(evidence.workflowFile, read), key);
        assert.equal(evidence.proofRun, pending ? "https://github.com/erwinmehehe/payrollph/actions/runs/43134412313/job/130906150181" : "https://github.com/erwinmehehe/payrollph/actions/runs/42777964271/job/129700836113", key);
        assert.equal(evidence.proofHead, pending ? "f0a005e4ef7a35672b5b3986556d9f2c4e1fca7e" : "27e68846e138da665dd8786d46e403ee724d6f1a", key);
      }
      if (old.method.status === "GAP") changes.publicByDesign++;
    } else {
      const evidence = current.method.privilegedOperation;
      assert.equal(evidence?.routeBlobSha, current.route.gitBlobSha, key);
      assert.equal(evidence?.credentialEnvironment, "HCM_SLA_CRON_SECRET", key);
      assert.equal(evidence?.methodCoverageCredits, 0, key);
      assert.equal(evidence?.independentSecurityReview, "PENDING", key);
      assert.equal(evidence?.productionCertified, false, key);
      assert.equal(evidence?.classificationApproval, "OWNER_APPROVED", key);
      assert.equal(evidence?.approvedOn, approval.approvedOn, key);
      assert.deepEqual(evidence?.ownerApprovalRecord, { file: OWNER_APPROVAL_FILE, blobSha: OWNER_APPROVAL_BLOB }, key);
      assert.equal(evidence?.classification, "RECLASSIFIED", key);
      assert.equal(evidence?.requiredHeader, "authorization", key);
      assert.equal(evidence?.headerForm, "Bearer", key);
      assert.equal(evidence?.denialStatus, 401, key);
      assert.equal(evidence?.evidenceLabel, "SOLO_VERIFIED_DEV_RECOVERY", key);
      assert.equal(evidence?.exactHeadPg16Http, "PENDING", key);
      assert.equal(evidence?.denialHarness, "scripts/qa/tenant-hcm-sla-escalate-http.mjs", key);
      assert.equal(evidence?.proofBlobSha, "823c27150d75d1bdd630ec914b7c0efc4565b7de", key);
      assert.equal(evidence?.proofBlobSha, sha(evidence.denialHarness, read), key);
      assert.equal(evidence?.contractFile, "tests/tenant-hcm-sla-escalate-contract.test.mjs", key);
      assert.equal(evidence?.contractBlobSha, "17a56b928916bee468b3bca339e215029b92df12", key);
      assert.equal(evidence?.contractBlobSha, sha(evidence.contractFile, read), key);
      if (old.method.status === "GAP") changes.privilegedTokenOnly++;
    }
    if (old.method.status === "GAP") changes.gapRelabels++;
  }
  assert.ok(changes.publicByDesign <= 8 && changes.privilegedTokenOnly <= 1,
    "Only the named nine uncredited architecture relabels are permitted");
  return changes;
}

/**
 * Reconcile only source-verified #1921 labels in a main-branch ledger.
 * Read approval, route and proof bytes from that same ref, not the PR checkout.
 * Return a copy only after validation; never mutate or credit an unknown method.
 */
export function reconcileArchitecturalMainStatuses(assert, manifest, expectedStatuses, read = readFileSync) {
  const specs = [...PUBLIC.map(([path, verb]) => [path, verb, "PUBLIC-BY-DESIGN"]),
    [WORKER.slice("POST ".length), "POST", "PRIVILEGED-OPERATIONS-TOKEN-ONLY"]];
  const statuses = structuredClone(expectedStatuses);
  const counts = { publicByDesign: 0, privilegedTokenOnly: 0 };
  for (const [path, verb, target] of specs) {
    const matches = manifest.allApiRouteFiles[path]?.methods.filter(row => row.name === verb);
    assert.equal(matches?.length, 1, "Exactly one approved architecture method is required: " + verb + " " + path);
    const row = matches[0];
    assert.equal(statuses[path]?.[verb], "GAP", "Architecture reconciliation cannot replace a credited method: " + path);
    assert.equal(row.testedBy, null, "Architecture classification cannot invent method proof: " + path);
    assert.ok(row.status === "GAP" || row.status === target, "Unapproved architecture status: " + path);
    if (row.status === "GAP") continue;
    statuses[path][verb] = target;
    if (target === "PUBLIC-BY-DESIGN") counts.publicByDesign++;
    else counts.privilegedTokenOnly++;
  }
  if (counts.publicByDesign || counts.privilegedTokenOnly) {
    // An identical before/after ledger must still verify all existing evidence.
    verifyArchitecturalRelabelDelta(assert, manifest, manifest, read);
  }
  return { statuses, ...counts };
}
