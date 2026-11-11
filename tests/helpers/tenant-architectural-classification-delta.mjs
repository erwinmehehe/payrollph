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
    if (current.method.status === old.method.status || current.method.status === "COVERED") continue;
    assert.equal(old.method.status, "GAP", "Unapproved status downgrade: " + key);
    const target = allowed.has(key) ? "PUBLIC-BY-DESIGN"
      : key === WORKER ? "PRIVILEGED-OPERATIONS-TOKEN-ONLY" : null;
    assert.ok(target, "No unrelated GAP may disappear: " + key);
    assert.equal(current.method.status, target, "Wrong architecture classification: " + key);
    assert.equal(current.route.gitBlobSha, old.route.gitBlobSha, "Route bytes changed: " + key);
    assert.equal(current.route.gitBlobSha, sha(current.path), "Source pin drift: " + key);
    assert.equal(current.method.testedBy, null, "No tenant-private proof credit: " + key);
    if (target === "PUBLIC-BY-DESIGN") {
      const evidence = current.method.classificationEvidence;
      assert.equal(evidence?.sourceBlobSha, current.route.gitBlobSha, key);
      assert.equal(evidence?.methodCoverageCredits, 0, key);
      assert.equal(evidence?.independentSecurityReview, "PENDING", key);
      assert.equal(evidence?.productionCertified, false, key);
      changes.publicByDesign++;
    } else {
      const evidence = current.method.privilegedOperation;
      assert.equal(evidence?.routeBlobSha, current.route.gitBlobSha, key);
      assert.equal(evidence?.credentialEnvironment, "HCM_SLA_CRON_SECRET", key);
      assert.equal(evidence?.methodCoverageCredits, 0, key);
      assert.equal(evidence?.independentSecurityReview, "PENDING", key);
      assert.equal(evidence?.productionCertified, false, key);
      changes.privilegedTokenOnly++;
    }
    changes.gapRelabels++;
  }
  assert.ok(changes.publicByDesign <= 8 && changes.privilegedTokenOnly <= 1,
    "Only the named nine uncredited architecture relabels are permitted");
  return changes;
}
