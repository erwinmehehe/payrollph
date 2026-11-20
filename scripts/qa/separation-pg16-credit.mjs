import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const separationRoute = "src/app/api/separation/route.ts";
export const separationProofKind = "separation-legal-employer-pg16";
const receiptPath = "scripts/qa/separation-pg16-http-receipt.json";
const holdPath = "scripts/qa/phase25-separation-hold.json";
const methods = ["GET", "POST", "PATCH"];
const anchors = {
  GET: { ownPositiveLine: 167, foreignDenialLine: 174 },
  POST: { ownPositiveLine: 154, foreignDenialLine: 178, unchangedDbLine: 182 },
  PATCH: { ownPositiveLine: 232, foreignDenialLine: 184, unchangedDbLine: 196 },
};

function blob(data) {
  const bytes = Buffer.from(data.toString().replaceAll("\r\n", "\n"));
  return createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
}

function exactHold(read) {
  const source = read(holdPath);
  assert.equal(blob(source), "005664e68e44abf709ae85ade1e5aee334a01fda");
  return JSON.parse(source).records[separationRoute];
}

export function hasSeparationPromotions(file) {
  return file?.methods.some(method => method.testedBy?.kind === separationProofKind);
}

export function buildSeparationRenewal(read = readFileSync) {
  const source = read(receiptPath);
  const receiptBlobSha = blob(source);
  assert.equal(receiptBlobSha, "e46ff86cc28c17fc4524eb3977c78b5ed337f3a5", "Separation receipt changed");
  const receipt = JSON.parse(source);
  assert.equal(receipt.label, "SOLO_VERIFIED_DEV_RECOVERY");
  assert.equal(receipt.postgresMajor, 16);
  assert.equal(receipt.transport, "localhost-http");
  assert.equal(receipt.coverageCredits, 0);
  assert.equal(receipt.fullPg16Suite.conclusion, "success");
  assert.deepEqual(Object.keys(receipt.methods), methods);
  for (const [file, expected] of Object.entries(receipt.sourcePins)) {
    assert.equal(blob(read(file)), expected, "Separation proof input changed: " + file);
  }
  const held = exactHold(read);
  assert.equal(held.gitBlobSha, receipt.sourcePins[separationRoute]);
  const file = "scripts/qa/final-pay-prior-employer-http.mjs";
  for (const method of held.methods) {
    const evidence = receipt.methods[method.name];
    assert.equal(evidence.result, "PASS");
    method.status = "COVERED";
    method.reason = "SOLO_VERIFIED_DEV_RECOVERY: source-pinned fictional PG16 HTTP separation proof with solo-maintainer source sign-off.";
    method.testedBy = {
      kind: separationProofKind, file, line: anchors[method.name].ownPositiveLine,
      ...anchors[method.name],
      routeBlobSha: held.gitBlobSha, proofBlobSha: receipt.sourcePins[file],
      receiptFile: receiptPath, receiptBlobSha, testedCommit: receipt.head,
      workflowJobIds: evidence.evidenceJobs, label: receipt.label,
    };
    delete method.reviewedUncertified;
  }
  return held;
}

export function verifySeparationRenewal(manifest, read = readFileSync) {
  assert.deepEqual(manifest.allApiRouteFiles[separationRoute], buildSeparationRenewal(read),
    "Only the sealed three-method separation renewal may restore the Phase 25 credits");
  return methods.length;
}

export function separationRenewalDelta(before, after) {
  if (!hasSeparationPromotions(after.allApiRouteFiles[separationRoute])) return 0;
  verifySeparationRenewal(after);
  if (hasSeparationPromotions(before.allApiRouteFiles[separationRoute])) {
    verifySeparationRenewal(before);
    return 0;
  }
  assert.deepEqual(before.allApiRouteFiles[separationRoute], exactHold(readFileSync));
  return methods.length;
}
