/** Enumerate exactly nine zero-credit architecture relabels, without weakening credit checks. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

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
const sha = path => {
  const value = readFileSync(path);
  return createHash("sha1").update("blob " + value.length + "\0").update(value).digest("hex");
};
const rows = manifest => new Map(Object.entries(manifest.allApiRouteFiles)
  .flatMap(([path, route]) => route.methods.map(method =>
    [method.name + " " + path, { path, route, method }])));

/** Base may already contain these accepted classifications, so post-merge delta is zero. */
export function verifyArchitecturalRelabelDelta(assert, beforeManifest, afterManifest) {
  const before = rows(beforeManifest), after = rows(afterManifest);
  const changes = { gapRelabels: 0, publicByDesign: 0, privilegedTokenOnly: 0 };
  for (const [key, old] of before) {
    const current = after.get(key);
    assert.ok(current, "API method disappeared: " + key);
    const target = allowed.has(key) ? "PUBLIC-BY-DESIGN"
      : key === WORKER ? "PRIVILEGED-OPERATIONS-TOKEN-ONLY" : null;
    if (target) assert.notEqual(current.method.status, "COVERED", "Classification cannot grant a tenant-private credit: " + key);
    if (!target || current.method.status !== target) {
      if (current.method.status === old.method.status || current.method.status === "COVERED") continue;
      assert.equal(old.method.status, "GAP", "Unapproved status downgrade: " + key);
    }
    assert.ok(target, "No unrelated GAP may disappear: " + key);
    assert.equal(current.method.status, target, "Wrong architecture classification: " + key);
    assert.ok(old.method.status === "GAP" || old.method.status === target, "Unapproved classification replacement: " + key);
    assert.equal(current.route.gitBlobSha, old.route.gitBlobSha, "Route bytes changed: " + key);
    assert.equal(current.route.gitBlobSha, sha(current.path), "Source pin drift: " + key);
    assert.equal(current.method.testedBy, null, "No tenant-private proof credit: " + key);
    if (target === "PUBLIC-BY-DESIGN") {
      const evidence = current.method.classificationEvidence;
      assert.equal(evidence?.sourceBlobSha, current.route.gitBlobSha, key);
      assert.equal(evidence?.methodCoverageCredits, 0, key);
      assert.equal(evidence?.independentSecurityReview, "PENDING", key);
      assert.equal(evidence?.productionCertified, false, key);
      assert.equal(evidence?.classificationApproval, "PENDING", "No owner classification approval recorded: " + key);
      assert.equal(evidence?.approvedOn, undefined, "Pending proposal cannot fabricate an approval date");
      assert.equal(evidence?.evidenceLabel, "SOLO_VERIFIED_DEV_RECOVERY", key);
      if (key.includes("/auth/saml/")) {
        assert.equal(evidence.category, "disabled-public-SAML-uniform-refusal", key);
        assert.equal(evidence.activeSamlLoginProven, false, key);
        assert.equal(evidence.mergedPr, 1896, key);
        assert.equal(evidence.boundaryFile, "src/lib/saml-disabled-boundary.ts", key);
        assert.equal(evidence.boundaryBlobSha, "ad19ba4fb718fddd9826df15f7740f482b795ad7", key);
        assert.equal(evidence.boundaryBlobSha, sha(evidence.boundaryFile), key);
        assert.equal(evidence.testFile, "tests/tenant-saml-disabled-boundary.test.ts", key);
        assert.equal(evidence.testBlobSha, "9afd5c6ec0c499b394d498ed6211d84e5f787e4b", key);
        assert.equal(evidence.testBlobSha, sha(evidence.testFile), key);
      } else {
        assert.equal(evidence.category, "public-prelogin-source-and-PG16", key);
        assert.equal(evidence.proofFile, "scripts/qa/tenant-prelogin-http.mjs", key);
        assert.equal(evidence.proofBlobSha, "1cd04c46ae9df3e2291df8f810917d98a59ef841", key);
        assert.equal(evidence.proofBlobSha, sha(evidence.proofFile), key);
        assert.equal(evidence.workflowFile, ".github/workflows/tenant-prelogin-http.yml", key);
        assert.equal(evidence.workflowBlobSha, "b452bbaa93639778142d9bffcc934d7ad554eb60", key);
        assert.equal(evidence.workflowBlobSha, sha(evidence.workflowFile), key);
        assert.equal(evidence.proofRun, "https://github.com/erwinmehehe/payrollph/actions/runs/42777964271/job/129700836113", key);
        assert.equal(evidence.proofHead, "27e68846e138da665dd8786d46e403ee724d6f1a", key);
      }
      if (old.method.status === "GAP") changes.publicByDesign++;
    } else {
      const evidence = current.method.privilegedOperation;
      assert.equal(evidence?.routeBlobSha, current.route.gitBlobSha, key);
      assert.equal(evidence?.credentialEnvironment, "HCM_SLA_CRON_SECRET", key);
      assert.equal(evidence?.methodCoverageCredits, 0, key);
      assert.equal(evidence?.independentSecurityReview, "PENDING", key);
      assert.equal(evidence?.productionCertified, false, key);
      assert.equal(evidence?.classificationApproval, "PENDING", key);
      assert.equal(evidence?.approvedOn, undefined, "Pending proposal cannot fabricate an approval date");
      assert.equal(evidence?.classification, "PROPOSED", key);
      assert.equal(evidence?.requiredHeader, "authorization", key);
      assert.equal(evidence?.headerForm, "Bearer", key);
      assert.equal(evidence?.denialStatus, 401, key);
      assert.equal(evidence?.evidenceLabel, "SOLO_VERIFIED_DEV_RECOVERY", key);
      assert.equal(evidence?.exactHeadPg16Http, "PENDING", key);
      assert.equal(evidence?.denialHarness, "scripts/qa/tenant-hcm-sla-escalate-http.mjs", key);
      assert.equal(evidence?.proofBlobSha, "823c27150d75d1bdd630ec914b7c0efc4565b7de", key);
      assert.equal(evidence?.proofBlobSha, sha(evidence.denialHarness), key);
      assert.equal(evidence?.contractFile, "tests/tenant-hcm-sla-escalate-contract.test.mjs", key);
      assert.equal(evidence?.contractBlobSha, "17a56b928916bee468b3bca339e215029b92df12", key);
      assert.equal(evidence?.contractBlobSha, sha(evidence.contractFile), key);
      if (old.method.status === "GAP") changes.privilegedTokenOnly++;
    }
    if (old.method.status === "GAP") changes.gapRelabels++;
  }
  assert.ok(changes.publicByDesign <= 8 && changes.privilegedTokenOnly <= 1,
    "Only the named nine uncredited architecture relabels are permitted");
  return changes;
}
