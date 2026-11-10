/** One method-only readiness GET credit; only the exact passing PG16 receipt is admissible. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const ROUTE_PATH = "src/app/api/readiness/workspace/route.ts";
export const RECEIPT_FILE = "scripts/qa/tenant-workspace-readiness-credit-receipt.json";
const RECEIPT_BLOB = "1097669e0c1dfc2e76067e077a910811168e93bd";
const PROOF_FILE = "scripts/qa/tenant-workspace-readiness-http.mjs";
const PROOF_HEAD = "7b46658a7ea9f5eee86662cf35d7ca1730b7b5f4";
const RUN_ID = 42814903331, JOB_ID = 129825397604;
const JOB_URL = "https://github.com/erwinmehehe/payrollph/actions/runs/" + RUN_ID + "/job/" + JOB_ID;
const EXPECTED_BLOBS = Object.freeze({
  "src/app/api/readiness/workspace/route.ts": "26378409dcfddc6bb0b726433e6896b3487a4cf7",
  "src/lib/workspace-readiness-boundary.ts": "782853dada317783100dd1ee40004fa7e6126244",
  "scripts/qa/tenant-workspace-readiness-http.mjs": "228db712a89f66ef775116b62e909f06cb1e6bb9",
  "scripts/qa/tenant-workspace-readiness-contract.mjs": "6ab9dbe2723f2f4f9bda92fc8baff5db0eb6de92",
  "scripts/qa/workspace-readiness-http.mjs": "6347d0527b4bea7aee49c548413a4a79452cf48a",
  ".github/workflows/tenant-workspace-readiness-http.yml": "74c8ce0ba396e14b36b27f03c2d3966c82e217bd",
});
const EXPECTED_LINES = Object.freeze({
  ownPositiveLine: 138, foreignDenialLine: 149, forgedSelectorLine: 157,
  unchangedDbLine: 144, revokedDenialLine: 191, revokedImmutabilityLine: 193,
  ownCountLine: 201, foreignCountLine: 202, negativeCountLine: 203,
});
function data(path, read) {
  const bytes = read(path);
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
}
export function gitBlobSha(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return createHash("sha1").update(Buffer.from("blob " + b.length + "\0")).update(b).digest("hex");
}
export function verifyWorkspaceReadinessReceipt(read = readFileSync) {
  const bytes = data(RECEIPT_FILE, read);
  assert.equal(gitBlobSha(bytes), RECEIPT_BLOB,
    "Readiness evidence receipt changed; never silently repin a replacement");
  const r = JSON.parse(bytes.toString("utf8"));
  assert.deepEqual([
    r.schema, r.evidenceLabel, r.method, r.proofPullRequest, r.proofHeadSha,
    r.proofMergeCommit, r.workflowRunId, r.workflowJobId, r.workflowUrl,
    r.workflowConclusion, r.intendedCreditCount, r.securityReview,
  ], [
    "payrollph-tenant-method-credit-receipt-v1", "SOLO_VERIFIED_DEV_RECOVERY",
    "GET /api/readiness/workspace", 1901, PROOF_HEAD,
    "dda898b05ba5dc14444ecb57b5c67d567bb3ea02", RUN_ID, JOB_ID, JOB_URL,
    "success", 1, "PENDING_INDEPENDENT_REVIEW",
  ]);
  assert.deepEqual(r.logResult, {
    family: "tenant-workspace-readiness-api-get", fictionalPostgresMajor: 16,
    independentAuthenticatedOwners: 2, distinctHigherIdVictim: true,
    allBusinessVictimIdsOverSix: true, ownSuccesses: 3, foreignDenials: 4,
    negativeChecks: 15, sqlStateUnchanged: true, launchApproved: false,
    payoutOrProviderCalls: 0, newMethodCredits: 0,
    independentlyAccepted: false, productionTested: false,
  });
  assert.deepEqual(r.sourceBlobs, EXPECTED_BLOBS);
  assert.deepEqual(r.proofLines, EXPECTED_LINES);
  for (const [path, sha] of Object.entries(EXPECTED_BLOBS))
    assert.equal(gitBlobSha(data(path, read)), sha,
      "Changed readiness route, loader, proof or workflow needs new PG16 evidence: " + path);
  for (const step of [
    "Confirm exact reviewed head",
    "Refuse unsafe targets, stale sources and fabricated readiness positives",
    "Initialize empty disposable PostgreSQL 16",
    "Build production-mode localhost app",
    "Verify real own 200, foreign 403, high-ID victim and unchanged SQL",
  ]) assert.ok(r.passedSteps.includes(step), "Missing executed job step: " + step);
  for (const flag of ["productionCertified", "liveEmployerDataUsed", "providerCalled", "moneyMoved"])
    assert.equal(r[flag], false, "Unreviewed production or provider claim: " + flag);
  const proof = data(PROOF_FILE, read).toString("utf8");
  const lines = proof.split("\n");
  for (const [key, needle] of [
    ["ownPositiveLine", "const own = await httpGet(endpoint(actor.org.id), actor.cookie)"],
    ["foreignDenialLine", "const denied = await httpGet(endpoint(target.org.id), attacker.cookie)"],
    ["forgedSelectorLine", "const forged = await httpGet(endpoint(victim.org.id)"],
    ["unchangedDbLine", "assert.deepEqual(await snapshot(), baseline"],
    ["revokedDenialLine", "const revoked = await httpGet(endpoint(a.org.id), a.cookie)"],
    ["revokedImmutabilityLine", "assert.deepEqual(await snapshot(), revokedBefore"],
    ["ownCountLine", "assert.equal(ownSuccesses, 3)"],
    ["foreignCountLine", "assert.equal(foreignDenials, 4)"],
    ["negativeCountLine", "assert.equal(negativeChecks, 15)"],
  ]) assert.ok(lines[r.proofLines[key]-1]?.includes(needle),
    "Missing real source-line anchor for " + key);
  for (const needle of [
    'seedEmployer("FILL" + i', 'Math.max(6, a[field].id, b[field].id)',
    "allBusinessVictimIdsOverSix: true", "ownFirstDuplicate.status, 400",
    "forged.status, 400", "requireDisposableWorkspaceReadiness();",
  ]) assert.ok(proof.includes(needle), "Missing whole-method proof: " + needle);
  const route = data(ROUTE_PATH, read).toString("utf8");
  const loader = data("src/lib/workspace-readiness-boundary.ts", read).toString("utf8");
  assert.ok(route.includes('searchParams.getAll("organizationId").length === 1'));
  const readAt = route.indexOf("return await buildTenantWorkspaceReadiness(organizationId)");
  assert.ok(readAt > route.indexOf("await assertOrganizationRole(") &&
    readAt > route.indexOf("await getAccess(user.id, organizationId)"),
    "Employer-wide role and membership must precede the data projection");
  assert.ok(!route.includes("return await buildReadinessPayload("));
  for (const needle of [
    "eq(employees.organizationId, organizationId)",
    "eq(payrollRuns.organizationId, organizationId)",
    'status: "not-launch-ready"', "ready: false",
  ]) assert.ok(loader.includes(needle), "Missing tenant-qualified loader bound: " + needle);
  return r;
}
export function expectedWorkspaceReadinessTestedBy(read = readFileSync) {
  const r = verifyWorkspaceReadinessReceipt(read);
  return {
    file: PROOF_FILE, line: 138,
    ownPositiveLine: 138, foreignDenialLine: 149, forgedSelectorLine: 157,
    unchangedDbLine: 144, revokedDenialLine: 191, revokedImmutabilityLine: 193,
    routeBlobSha: EXPECTED_BLOBS[ROUTE_PATH],
    loaderBlobSha: EXPECTED_BLOBS["src/lib/workspace-readiness-boundary.ts"],
    proofBlobSha: EXPECTED_BLOBS[PROOF_FILE],
    workflowFile: ".github/workflows/tenant-workspace-readiness-http.yml",
    workflowBlobSha: EXPECTED_BLOBS[".github/workflows/tenant-workspace-readiness-http.yml"],
    receiptFile: RECEIPT_FILE, receiptBlobSha: RECEIPT_BLOB,
    evidenceLabel: "SOLO_VERIFIED_DEV_RECOVERY", proofPullRequest: 1901,
    verifiedHeadSha: PROOF_HEAD, workflowRunId: RUN_ID, workflowJobId: JOB_ID,
    evidence: JOB_URL, postgresMajor: 16,
    ownSuccesses: 3, foreignDenials: 4, negativeChecks: 15,
    allBusinessVictimIdsOverSix: true, sqlStateUnchanged: true,
    coverageCredits: 1, independentlyAccepted: false,
    independentSecurityReview: "PENDING", productionTested: false,
    launchApproved: false, providerCalled: false,
    scope: "One exact-final-head fictional PG16 GET own/foreign/forged/revoked HTTP method ledger credit; no tenant-wide, launch or production acceptance.",
  };
}
export function verifyWorkspaceReadinessCredit(manifest, read = readFileSync) {
  const route = manifest?.allApiRouteFiles?.[ROUTE_PATH];
  const method = route?.methods?.find(x => x.name === "GET");
  assert.equal(route?.gitBlobSha, EXPECTED_BLOBS[ROUTE_PATH]);
  assert.equal(route?.methods?.length, 1, "Only the reviewed GET can receive this credit");
  assert.equal(method?.status, "COVERED");
  assert.equal(method?.reviewedUncertified, undefined);
  assert.deepEqual(method?.testedBy, expectedWorkspaceReadinessTestedBy(read));
  const uses = Object.entries(manifest.allApiRouteFiles).flatMap(([path, route]) =>
    route.methods.filter(m => m.testedBy?.receiptFile === RECEIPT_FILE)
      .map(m => m.name + " " + path));
  assert.deepEqual(uses, ["GET " + ROUTE_PATH],
    "No unrelated method may borrow the workspace-readiness receipt");
  return 1;
}
