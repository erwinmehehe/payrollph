/** One source-pinned, zero-runtime-change, provisional staffing policy GET method credit.
 * Both fictional PG16 jobs were successful on the same #1637 exact head. The
 * original runners awarded zero credits, so this is a separate later proposal.
 * This never represents independent human acceptance or production certification.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const STAFFING_GET_ROUTE = "src/app/api/workforce/demand-staffing/policies/route.ts";
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
  "rosterWrites": 0
});

function gitBlob(path) {
  const bytes = readFileSync(path);
  return createHash("sha1").update(Buffer.from("blob " + bytes.length + "\0"))
    .update(bytes).digest("hex");
}
function line(path, n) {
  const rows = readFileSync(path, "utf8").split("\n");
  assert.ok(Number.isSafeInteger(n) && n > 0 && n <= rows.length,
    path + ":" + n + " must be real evidence");
  return rows[n - 1];
}
export function verifyStaffingPolicyGetCredit(manifest) {
  const entry = manifest.allApiRouteFiles[STAFFING_GET_ROUTE];
  const method = entry?.methods.find(m => m.name === "GET");
  assert.equal(entry?.gitBlobSha, STAFFING_GET_EVIDENCE.routeBlobSha,
    "Changed GET source requires a new exact-head PG16 proof");
  assert.equal(method?.status, "COVERED", "No untested staffing GET credit");
  assert.match(method?.reason ?? "", /^Provisional /);
  assert.deepEqual(method?.testedBy, STAFFING_GET_EVIDENCE,
    "Never borrow another method or claim invented coverage receipts");
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
  ]) assert.equal(gitBlob(path), expected, path + ": stale source proof; revoke credit");
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
