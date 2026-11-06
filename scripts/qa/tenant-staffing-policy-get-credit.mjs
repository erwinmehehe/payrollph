/** One source-pinned, zero-runtime-change, provisional staffing policy GET method credit.
 * Both fictional PG16 jobs were successful on the same #1637 exact head. The
 * original runners awarded zero credits, so this is a separate later proposal.
 * This never represents independent human acceptance or production certification.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const STAFFING_GET_ROUTE = "src/app/api/workforce/demand-staffing/policies/route.ts";
/** Fresh source-current PG16 HTTP proof is supplementary to the immutable #1637 history.
 * Do not treat the old proof as valid for the changed integrity helper alone.
 * This overlay grants zero new credits and still awaits domain/security review.
 */
export const STAFFING_GET_INTEGRITY_REPROOF = Object.freeze({
  "kind": "staffing-approved-integrity-disposable-pg16-http-supplement",
  "prNumber": 1793,
  "verifiedPrHeadSha": "c563b772117b6c53686d0c0da6602bc29f75788f",
  "workflowRunId": 42187409312,
  "workflowJobId": 127790928217,
  "evidence": "https://github.com/erwinmehehe/payrollph/actions/runs/42187409312/job/127790928217",
  "helperFile": "src/lib/workforce-demand-staffing-policy-server.ts",
  "helperBlobSha": "995ede7fb6c2757053b10ff9b55ac24838bb017a",
  "proofFile": "scripts/qa/tenant-staffing-policy-approved-integrity-http.mjs",
  "proofBlobSha": "7e37df8cb2e7b97da115432aeb97325a770b2c7c",
  "contractFile": "tests/tenant-staffing-policy-approved-integrity-http.test.mjs",
  "contractBlobSha": "663d1b922baf7251fbacb3d7a083f3a89729a514",
  "workflowFile": ".github/workflows/tenant-staffing-policy-approved-integrity-http.yml",
  "workflowBlobSha": "170a54f3ca906036b23552f37cca8263ee8d7bac",
  "positiveOwnEmployers": 2,
  "higherIdVictim": true,
  "tamperedContentDenied": true,
  "tamperedReceiptDenied": true,
  "missingReceiptDenied": true,
  "foreignSqlUnchanged": true,
  "coverageCredits": 0,
  "reviewStatus": "PENDING",
  "independentlyAccepted": false,
  "productionCertified": false,
  "payrollOrProviderOperations": 0
});

export const STAFFING_GET_EVIDENCE = Object.freeze({
  "file": "scripts/qa/tenant-wfm-demand-read-overlay-http.mjs",
  "line": 105,
  "ownPositiveLine": 105,
  "foreignDenialLine": 117,
  "forgedSelectorLine": 122,
  "unchangedDbLine": 217,
  "victimIdOrderingLine": 53,
  "permissionOverlayLine": 158,
  "revokedDenialLine": 212,
  "managerApprovedLine": 187,
  "managerManageDeniedLine": 193,
  "approvalPositiveFile": "scripts/qa/tenant-wrk01-staffing-writes-http.mjs",
  "approvalPositiveLine": 353,
  "approvalIntegrityLine": 359,
  "methodActions": [
    "manage",
    "approved"
  ],
  "evidenceLabel": "SOLO_VERIFIED_DEV_RECOVERY",
  "prNumber": 1637,
  "verifiedPrHeadSha": "2e14551d2ea88b72fb53d62da3682f87f8ea521a",
  "workflowRunId": 41164870341,
  "workflowJobId": 124430238281,
  "approvedWorkflowRunId": 41164870305,
  "approvedWorkflowJobId": 124430150239,
  "evidence": "https://github.com/erwinmehehe/payrollph/actions/runs/41164870341/job/124430238281",
  "approvedEvidence": "https://github.com/erwinmehehe/payrollph/actions/runs/41164870305/job/124430150239",
  "routeBlobSha": "e0ea8e23ffad6ca72edd5ef8da4dbe3a332d041c",
  "proofBlobSha": "595539e672a3dc121f709b44ce045f432d7d9d92",
  "contractFile": "tests/tenant-wfm-demand-read-overlay.test.mjs",
  "contractBlobSha": "d03d2814cc989a3743ac520827d45b6a2b43b396",
  "workflowFile": ".github/workflows/tenant-wfm-demand-read-overlay-http.yml",
  "workflowBlobSha": "a7b23d7680e9a36a35d1d736e7a8bd2b9d01ccfc",
  "approvedProofBlobSha": "b7b2d8941c40d264f734dd3fec5e69a5dc453ae2",
  "approvedWorkflowFile": ".github/workflows/tenant-wrk01-staffing-writes-http.yml",
  "approvedWorkflowBlobSha": "1be21bad4a1a7c150c28c9f6c2f51d776de0da7e",
  "postgresMajor": 16,
  "ownerReviewer": "erwinmehehe",
  "ownerIsOnlyReviewer": true,
  "independentlyAccepted": false,
  "productionCertified": false,
  "productionTested": false,
  "providerCalls": 0,
  "payrollWrites": 0,
  "rosterWrites": 0,
  "integrityReproof": STAFFING_GET_INTEGRITY_REPROOF
});

/**
 * Historical #1637 PG16 evidence depends on these unchanged authorization,
 * policy-integrity, and SQL helpers, not just the route handler. They were
 * verified byte-identical between the proof head and this PR before pinning.
 * Any drift must fail closed until the revised source is independently reproven.
 */
export const STAFFING_GET_HELPER_BLOBS = Object.freeze({
  "src/lib/auth.ts": "b13275e0e09b629ddb679c55e7898da44c72ad20",
  "src/lib/access.ts": "08d3481dbd20279a4a8aef64f0932f79bec48444",
  "src/lib/workforce-operational-demand-scope.ts": "ba75509804307a0bc4e68b829efc855a3e4cbae7",
  "src/lib/workforce-demand-staffing-policy-server.ts": "995ede7fb6c2757053b10ff9b55ac24838bb017a",
  "src/lib/workforce-demand-staffing-policy.ts": "03f7e150d18092566cd2197568370f65e1cc6d0b",
  "src/lib/workforce-issued-demand-validation.ts": "2e56bc0fc2d64da310c5b936d08ae6f6adfa456a",
  "src/lib/workforce-schedule-receipt.ts": "1a1719a9681eaadb0caa0ff933192f846645d3c6",
  "src/lib/workforce-issued-demand-evidence.ts": "a5e0014b8b631ea21d87d8fab18b31ffc83197f9",
  "src/lib/payroll-period-ui.ts": "69809c7ab56618b5b2299439654007e41e40b0d1",
  "src/db/index.ts": "7a5718d0a99ce5b3a7f0f25e385f79a61be807f6",
  "src/db/schema.ts": "3f504163c9847a99434a5e01a72c120dfd680a02"
});

function gitBlob(path, read = readFileSync) {
  const bytes = read(path);
  return createHash("sha1").update(Buffer.from("blob " + bytes.length + "\0"))
    .update(bytes).digest("hex");
}
function line(path, n) {
  const rows = readFileSync(path, "utf8").split("\n");
  assert.ok(Number.isSafeInteger(n) && n > 0 && n <= rows.length,
    path + ":" + n + " must be real evidence");
  return rows[n - 1];
}
export function verifyStaffingPolicyGetCredit(manifest, read = readFileSync) {
  const entry = manifest.allApiRouteFiles[STAFFING_GET_ROUTE];
  const method = entry?.methods.find(m => m.name === "GET");
  assert.equal(entry?.gitBlobSha, STAFFING_GET_EVIDENCE.routeBlobSha,
    "Changed GET source requires a new exact-head PG16 proof");
  assert.equal(method?.status, "COVERED", "No untested staffing GET credit");
  assert.match(method?.reason ?? "", /^Provisional /);
  assert.deepEqual(method?.testedBy, STAFFING_GET_EVIDENCE,
    "Never borrow another method or claim invented coverage receipts");

  // Old #1637 GET proof remains immutable, but the modified authorization and
  // integrity helper is accepted only with this separate actual PG16 HTTP run.
  const supplemental = method?.testedBy?.integrityReproof;
  assert.deepEqual(supplemental, STAFFING_GET_INTEGRITY_REPROOF,
    "Updated helper requires separately pinned, passing two-employer negative HTTP evidence");
  assert.equal(supplemental.coverageCredits, 0, "No new method credit from supplemental test");
  assert.equal(supplemental.reviewStatus, "PENDING", "Do not invent independent security approval");
  assert.equal(supplemental.independentlyAccepted, false);
  assert.equal(supplemental.productionCertified, false);
  assert.equal(supplemental.helperBlobSha,
    STAFFING_GET_HELPER_BLOBS["src/lib/workforce-demand-staffing-policy-server.ts"]);
  for (const [path, expected] of [
    [supplemental.proofFile, supplemental.proofBlobSha],
    [supplemental.contractFile, supplemental.contractBlobSha],
    [supplemental.workflowFile, supplemental.workflowBlobSha],
    [supplemental.helperFile, supplemental.helperBlobSha],
  ]) assert.equal(gitBlob(path, read), expected,
    path + ": new security-integrity proof drifted; re-run PG16 before retaining provisional credit");
  const newProof = readFileSync(supplemental.proofFile, "utf8");
  for (const dimension of [
    "for (const e of [a, b, victim]) await approve(e)",
    "victim.policy.id > a.policy.id && victim.policy.id > b.policy.id",
    'await verified(e, false, "source_review"',
    'set({ contentSha256: "f".repeat(64) })',
    'set({ receiptSha256: "f".repeat(64) })',
    'await db.delete(s.workforceDemandStaffingPolicyEvents)',
    'await unchangedForeign(e, foreignBefore',
    "coverageCredits: 0, productionCertified: false",
  ]) assert.ok(newProof.includes(dimension),
    "Missing supplemental fail-closed HTTP dimension: " + dimension);

  assert.equal(method.testedBy.ownerIsOnlyReviewer, true);
  assert.equal(method.testedBy.independentlyAccepted, false);
  assert.equal(method.testedBy.productionCertified, false);
  assert.equal(method.testedBy.payrollWrites, 0);
  assert.deepEqual(method.testedBy.methodActions, ["manage", "approved"]);
  for (const [path, expected] of [
    [STAFFING_GET_ROUTE, STAFFING_GET_EVIDENCE.routeBlobSha],
    [STAFFING_GET_EVIDENCE.file, STAFFING_GET_EVIDENCE.proofBlobSha],
    [STAFFING_GET_EVIDENCE.contractFile, STAFFING_GET_EVIDENCE.contractBlobSha],
    [STAFFING_GET_EVIDENCE.workflowFile, STAFFING_GET_EVIDENCE.workflowBlobSha],
    [STAFFING_GET_EVIDENCE.approvalPositiveFile, STAFFING_GET_EVIDENCE.approvedProofBlobSha],
    [STAFFING_GET_EVIDENCE.approvedWorkflowFile, STAFFING_GET_EVIDENCE.approvedWorkflowBlobSha],
  ]) assert.equal(gitBlob(path, read), expected, path + ": stale source proof; revoke credit");
  // Protect transitive source equivalence for the historical two-mode proof.
  // CI and the path-triggered guard both enforce this fail-closed check.
  for (const [path, expected] of Object.entries(STAFFING_GET_HELPER_BLOBS)) {
    assert.equal(gitBlob(path, read), expected,
      path + ": transitive security helper changed; revoke credit pending new exact-head PG16 proof");
  }
  assert.match(line(STAFFING_GET_EVIDENCE.file, 105),
    /const own = await request\(endpoint\(row, actor\.org\.id/);
  assert.match(line(STAFFING_GET_EVIDENCE.file, 117),
    /const foreign = await request\(endpoint\(row, victim\.org\.id/);
  assert.match(line(STAFFING_GET_EVIDENCE.file, 122),
    /const stolenSite = await request\(endpoint\(row, actor\.org\.id/);
  assert.match(line(STAFFING_GET_EVIDENCE.file, 217),
    /assertImmutableDemandSources\(beforeReads\.get\(victim\.org\.id\)/);
  assert.match(line(STAFFING_GET_EVIDENCE.file, 187), /mode=approved/);
  assert.match(line(STAFFING_GET_EVIDENCE.file, 193), /mode=manage/);
  assert.match(line(STAFFING_GET_EVIDENCE.approvalPositiveFile, 353),
    /assert\.equal\(approvedView\.status, 200\)/);
  assert.match(line(STAFFING_GET_EVIDENCE.approvalPositiveFile, 359),
    /approvalIntegrity, "matches_hash"/);
  const overlay = readFileSync(STAFFING_GET_EVIDENCE.file, "utf8");
  const approved = readFileSync(STAFFING_GET_EVIDENCE.approvalPositiveFile, "utf8");
  assert.match(overlay, /for \(const actor of \[a, b\]\)/);
  assert.match(overlay, /assertBoundDemandRead\(kind, own, c, persisted\)/);
  assert.match(overlay, /victim\.seeded\[row\.key\]\.id > a\.seeded\[row\.key\]\.id/);
  assert.match(approved, /approvedRows\.find\(p => p\.id === approved\.row\.id\)/);
  assert.match(approved, /assertNoForeignPolicy\(approvedView/);
  assert.match(approved, /for \(const e of \[a, b, victim\]\)/);
  for (const wf of [STAFFING_GET_EVIDENCE.workflowFile,
    STAFFING_GET_EVIDENCE.approvedWorkflowFile]) {
    const source = readFileSync(wf, "utf8");
    assert.match(source, /image: postgres:16/);
    assert.match(source, /npm start -- -H 127\.0\.0\.1/);
    assert.doesNotMatch(source, /vercel deploy|db:migrate:production|npm run deploy/);
  }
  return 1;
}
