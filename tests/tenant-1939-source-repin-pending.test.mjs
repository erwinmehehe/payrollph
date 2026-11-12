import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readPendingSignupSourceRevalidation } from "./helpers/tenant-architectural-classification-delta.mjs";

const blobSha = (path) => {
  const bytes = readFileSync(path);
  return createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
};

test("historical source label approval and newer proof remain separate", () => {
  const record = readPendingSignupSourceRevalidation(assert);
  assert.equal(record.status, "PENDING_OWNER_REVIEW");
  assert.equal(record.nonclaims.ownerApprovedChangedSources, false);
  assert.equal(record.nonclaims.independentSecurityReview, false);
  assert.equal(record.proposedRuntimeSourcePins.length, 3);
});

test("signup source repin is exact, zero-credit and still expressly awaiting owner approval", () => {
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const proposal = JSON.parse(readFileSync("docs/qa/tenant-1939-source-review-pending.json", "utf8"));
  assert.equal(proposal.status, "PENDING_OWNER_REVIEW");
  assert.equal(proposal.nonclaims.ownerApprovedChangedSources, false);
  assert.equal(proposal.nonclaims.independentSecurityReview, false);
  assert.equal(proposal.nonclaims.productionCertified, false);
  assert.equal(proposal.nonclaims.tenantCoveredCreditsGranted, 0);
  assert.equal(proposal.nonclaims.releaseFlagsChanged, false);
  assert.equal(blobSha(proposal.originalClassificationApproval.file),
    proposal.originalClassificationApproval.blobSha, "historical signed approval must be untouched");
  const proof = proposal.preloginProof;
  assert.equal(blobSha(proof.path), proof.blobSha);
  assert.equal(blobSha(proof.workflowPath), proof.workflowBlobSha);
  assert.match(proof.passedJob, /github\.com\/erwinmehehe\/payrollph\/actions\/runs\/\d+\/job\/\d+$/);
  assert.equal(proposal.proposedRuntimeSourcePins.length, 3);
  for (const { path, now } of proposal.proposedRuntimeSourcePins) {
    const record = manifest.allApiRouteFiles[path];
    assert.ok(record);
    assert.equal(blobSha(path), now);
    assert.equal(record.gitBlobSha, now);
    const method = record.methods.find((row) => row.name === "POST");
    assert.equal(method.status, "PUBLIC-BY-DESIGN");
    assert.equal(method.testedBy, null);
    assert.equal(method.classificationEvidence.sourceBlobSha, now);
    assert.equal(method.classificationEvidence.proofBlobSha, proof.blobSha);
    assert.equal(method.classificationEvidence.workflowBlobSha, proof.workflowBlobSha);
    assert.equal(method.classificationEvidence.proofRun, proof.passedJob);
    assert.equal(method.classificationEvidence.proofHead, proof.passedHead);
    assert.equal(method.classificationEvidence.methodCoverageCredits, 0);
    assert.equal(method.classificationEvidence.independentSecurityReview, "PENDING");
    assert.equal(method.classificationEvidence.ownerApprovalRecord.blobSha,
      proposal.originalClassificationApproval.blobSha);
  }
});
