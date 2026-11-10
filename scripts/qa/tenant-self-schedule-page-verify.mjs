/**
 * Strict source-only guard for the distinct PII-02 employee schedule SSR GET.
 * This page remains an unaccepted manifest GAP: no credit can be inferred
 * from a successful isolated PG16 test without independent review.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const PAGE = "src/app/self/schedule-receipts/page.tsx";
const ORIGINAL = "77f085f1b0f20aa7786e893a825e453259429ac0";
const CHANGED = "cf5947bea1bc5aa8a8b87f54d53bc4ffceb2575e";
const API = "src/app/api/self/schedule-receipts/route.ts";
function blobSha(path) {
  const content = readFileSync(path);
  return createHash("sha1").update(Buffer.from("blob " + content.length + "\0"))
    .update(content).digest("hex");
}
function pinned(line, text, path) {
  const source = readFileSync(path, "utf8").split("\n");
  assert.ok(Number.isInteger(line) && line > 0 && line <= source.length,
    path + ": missing proof line " + line);
  assert.ok(source[line - 1].includes(text), path + ":" + line + ": proof line drifted");
}
export function verifyUnacceptedSelfSchedulePage({ entry, currentBlob, originalBlob, manifest }) {
  assert.equal(entry.path, PAGE);
  assert.equal(entry.status, "GAP", "PII-02 page may not be promoted without reviewed proof");
  assert.equal(entry.testedBy, undefined, "Unaccepted page cannot claim COVERED evidence");
  assert.equal(entry.hasAction, false, "SSR GET does not certify POST/acknowledgments");
  assert.equal(originalBlob, ORIGINAL, "Historical employee page SHA must remain pinned");
  assert.equal(currentBlob, CHANGED, "Unreviewed source drift requires new page evidence");
  assert.equal(entry.blob, CHANGED, "Current source SHA must agree with manifest");
  assert.equal(blobSha(PAGE), CHANGED);
  assert.match(entry.reason, /^Still GAP: PII-02 /);
  const review = entry.reviewedUncertified;
  assert.deepEqual(review, {
    kind: "pii02-ess-self-schedule-SSR-GET-PG16-unaccepted",
    originalPageBlobSha: ORIGINAL, pageBlobSha: CHANGED,
    proofFile: "scripts/qa/tenant-self-schedule-page-http.mjs",
    proofBlobSha: "9b1fd190a2b2833b5ca6c4cf0bcab8a13feea050",
    contractFile: "tests/tenant-self-schedule-page-contract.test.mjs",
    contractBlobSha: "1260712b620ce35063d2c64b77369309cb3d4cfe",
    workflowFile: ".github/workflows/tenant-self-schedule-page-http.yml",
    workflowBlobSha: "244f44c4bc6c320341eaf20377d97c08aba9c94c",
    ownPositiveLine: 98,
    forgedSelectorDenialLine: 112,
    unchangedDbLine: 120,
    wrongRoleDenialLine: 132,
    pageActionCredits: 0, apiMethodCredits: 0,
    independentlyAccepted: false, productionCertified: false,
  }, "Only exact-source zero-credit PII-02 page candidate is allowed");
  for (const [file, sha] of [
    [review.proofFile, review.proofBlobSha],
    [review.contractFile, review.contractBlobSha],
    [review.workflowFile, review.workflowBlobSha],
  ]) assert.equal(blobSha(file), sha, "Unreviewed proof, contract or CI source drift: " + file);
  const actual = readFileSync(PAGE, "utf8");
  for (const key of ["ids", "business", "guards"]) {
    assert.ok(Array.isArray(entry[key]) && entry[key].length > 0);
    for (const pin of entry[key]) pinned(pin.line, pin.token, PAGE);
  }
  const position = x => actual.indexOf(x);
  const ordering = [
    'process.env.WFM_SCHEDULE_RECEIPTS_ENABLED !== "true"',
    "await getSessionUser()",
    "const params = await searchParams",
    "const [employee] = await db.select",
    'employee.status !== "Active"',
    "const access = await getAccess(session.id, employee.organizationId)",
    'access.role !== "employee"',
    "await assertMembership(session.id, employee.organizationId)",
    "receiptPilotAllowed(employee.organizationId",
    "<EmployeeScheduleReceipts",
  ];
  let previous = -1;
  for (const marker of ordering) {
    const current = position(marker);
    assert.ok(current > previous,
      "Employee, active-role, tenant session and pilot guards must run before client mount: " + marker);
    previous = current;
  }
  assert.match(actual, /validReceiptId\(session\.employeeId\)/);
  assert.match(actual, /data-organization-id=\{employee\.organizationId\}/);
  assert.match(actual, /Object\.prototype\.hasOwnProperty\.call\(params, key\)/);
  for (const selector of ["organizationId", "employeeId", "userId", "orgUnitId", "workDate"]) {
    assert.ok(actual.includes('"' + selector + '"'), "Reject scope selector: " + selector);
  }
  assert.ok(!actual.includes("primaryOrganizationId("),
    "Self service may never silently fall back to a different employer");
  pinned(review.ownPositiveLine,
    "const own = await request(PATH, actor.self.cookie);", review.proofFile);
  pinned(review.forgedSelectorDenialLine,
    "assertDeniedPage(await request(PATH + forged, actor.self.cookie),", review.proofFile);
  pinned(review.unchangedDbLine,
    "assertUnchanged(before.get(subject.org.id), await snapshot(subject.org.id),", review.proofFile);
  pinned(review.wrongRoleDenialLine,
    "assertDeniedPage(await request(PATH, wrongRole.cookie),", review.proofFile);
  const proof = readFileSync(review.proofFile, "utf8");
  assert.ok(proof.indexOf("requireDisposableScheduleReceipt();") >= 0 &&
    proof.indexOf("requireDisposableScheduleReceipt();") <
      proof.indexOf('import("../../src/db/index.ts")'),
    "Fictional-only CI gate must run before importing DB modules");
  for (const marker of [
    'seed("ATTA", nonce)', 'seed("ATTB", nonce)', 'seed("VICTIM", nonce)',
    'assert.deepEqual(subjects.map(e => e.org.id), [1, 2, 3])',
    "const wrongRole = await employeeSession", "status: \"Inactive\"",
    "userOrganizations).set({ active: false })",
    "const finalBefore = await Promise.all(subjects.map(e => snapshot(e.org.id)))",
    "pageActionCredits: 0, apiMethodCredits: 0, productionAccepted: false",
  ]) assert.ok(proof.includes(marker), "Missing independent own/foreign/revoked receipt: " + marker);
  assert.doesNotMatch(proof, /method:\s*["'](?:POST|PATCH|PUT|DELETE)["']/,
    "This page-only proof cannot mutate business records through HTTP");
  const workflow = readFileSync(review.workflowFile, "utf8");
  for (const marker of [
    "image: postgres:16", "github.event.pull_request.head.sha",
    "WFM_SCHEDULE_RECEIPTS_ENABLED: \"true\"",
    "WFM_SCHEDULE_RECEIPTS_ALLOWED_ORGANIZATION_IDS: \"1,2,3\"",
    "node --import tsx scripts/qa/tenant-self-schedule-page-http.mjs",
    "PAYMONGO_DISBURSEMENTS_ENABLED: \"false\"",
    "XENDIT_PAYOUTS_ENABLED: \"false\"",
  ]) assert.ok(workflow.includes(marker), "Missing source-current disposable CI bound: " + marker);
  const api = manifest.allApiRouteFiles[API];
  assert.equal(api.gitBlobSha, "b490bbb2aab7471901b769bd410c80652566daf8");
  assert.equal(blobSha(API), api.gitBlobSha, "No change to already-credited API methods");
  assert.deepEqual(api.methods.map(method => method.status), ["COVERED", "COVERED"]);
  assert.deepEqual(api.methods.map(method => method.testedBy?.prNumber), [1520, 1520]);
  return true;
}
