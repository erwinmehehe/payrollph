/**
 * One provisional legacy billing POST credit, sealed to a real final-head PG16
 * job. This is evidence reconciliation, never a PayMongo/payment authorization.
 * A status-only flip, borrowed BIR/subscription receipt or source repin fails.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const BILLING_POST_PATH = "src/app/api/billing/route.ts";
export const BILLING_POST_RECEIPT = "scripts/qa/tenant-billing-post-credit-receipt.json";
export const BILLING_POST_RECEIPT_SHA = "6c9f9e16cbd9d7c3955e9ff431ec4fd1e2bfb473";
export const BILLING_POST_PROOF_FILE = "scripts/qa/tenant-billing-paymongo-http.mjs";
const GIT_BLOB_SHA = buffer => {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  return createHash("sha1").update(Buffer.from("blob " + bytes.length + "\0"))
    .update(bytes).digest("hex");
};

const EXACT_RESULT = {
  method: "POST /api/billing", postgresMajor: 16,
  independentOwnPositiveEmployers: 2,
  higherIdVictimPersisted: true, victimBusinessIdsOverSix: true,
  ownCheckout201: 2, foreign403: 2, anonymous401: 2, crossSite403: 1,
  unitScopedDenied: true, mfaDenied: true,
  forgedForeignSelectorsIgnored: true, victimBusinessAndAuditUnchanged: true,
  noRealPaymongoOrMoneyMovement: true, productionTested: false,
  independentlyAccepted: false, coverageCredits: 0,
};
const ANCHOR_TEXT = {
  orderingLine: "victim[field].id > Math.max(6, a[field].id, b[field].id)",
  foreignDenialLine: "deny(foreign, 403, victim",
  forgedSelectorLine: "subscriptionId: subVictim.id, invoiceId: victim.baseInvoice.id",
  ownPositiveLine: "assert.equal(own.status, 201",
  unchangedDbLine: "snapshot(victim.org.id), victimBefore",
  sourceWriteLine: "after.invoices.some(i => i.id === own.json.invoice.id",
  providerReceiptLine: "assert.equal(events().length, ++successCount)",
};

export function readBillingPostReceipt(read = readFileSync) {
  const receiptBytes = read(BILLING_POST_RECEIPT);
  assert.equal(GIT_BLOB_SHA(receiptBytes), BILLING_POST_RECEIPT_SHA,
    "BILLING_CREDIT_REFUSED: evidence receipt replaced or fabricated");
  const receipt = JSON.parse(receiptBytes);
  assert.equal(receipt.label, "SOLO_VERIFIED_DEV_RECOVERY");
  assert.equal(receipt.method, "POST /api/billing");
  assert.deepEqual(receipt.proofPullRequests, [1874, 1900]);
  assert.equal(receipt.sourceHead, "09f172f8280d345ed57decbe8a05aaf3a4e066e7");
  assert.equal(receipt.workflowRunId, 42809117765);
  assert.equal(receipt.workflowJobId, 129805758274);
  assert.equal(receipt.executedLogPrefix, "TENANT_PAYMONGO_CHECKOUT_HTTP_COMPLETE");
  assert.deepEqual(receipt.executedResult, EXACT_RESULT);
  assert.equal(receipt.exactHeadWorkflows.length, 8);
  const runs = new Map(receipt.exactHeadWorkflows.map(row => [row.name, row]));
  for (const [name, id] of [
    ["Tenant legacy PayMongo checkout POST (fictional PG16 real HTTP)", 42809117765],
    ["Security HTTP Smoke", 42809117843], ["CI", 42809117815],
    ["CodeQL Security", 42809117846], ["Payout Payroll Isolation", 42809117590],
    ["Live RBAC Sandbox Smoke", 42809117708], ["PR Change Risk (Advisory)", 42809117632],
    ["SQL Migration History Guard (Advisory)", 42809117579],
  ]) {
    assert.equal(runs.get(name)?.id, id, "BILLING_CREDIT_REFUSED: missing exact-head run " + name);
    assert.equal(runs.get(name)?.result, "success", "BILLING_CREDIT_REFUSED: unpassed workflow " + name);
  }
  assert.equal(receipt.creditsAtProofExecution, 0);
  assert.equal(receipt.proposedCreditsAfterFinalHeadReview, 1);
  assert.equal(receipt.independentlyAccepted, false);
  assert.equal(receipt.productionCertified, false);
  assert.equal(receipt.realProviderCalled, false);
  assert.equal(receipt.noProductionPayouts, true);
  assert.equal(receipt.sourceReviewRequiredIfAnyPinnedBlobDrifts, true);
  assert.equal(Object.keys(receipt.inputBlobs).length, 9);
  for (const [file, sha] of Object.entries(receipt.inputBlobs)) {
    assert.equal(GIT_BLOB_SHA(read(file)), sha,
      "BILLING_CREDIT_REFUSED: current input differs from executed HTTP proof: " + file);
  }
  assert.equal(receipt.inputBlobs[BILLING_POST_PATH], "6ccf4135f824f5c46ea7aceabdcae811c75d2e15");
  assert.equal(receipt.inputBlobs[BILLING_POST_PROOF_FILE], "d481f689221eb1c92d839c95367053b6bd499337");
  const lines = read(BILLING_POST_PROOF_FILE).toString("utf8").split("\n");
  for (const [key, fragment] of Object.entries(ANCHOR_TEXT)) {
    const line = receipt.methodProofAnchors[key];
    assert.ok(Number.isSafeInteger(line) && line > 0 && lines[line - 1]?.includes(fragment),
      "BILLING_CREDIT_REFUSED: changed proof anchor " + key);
  }
  // Check the independent second owner, real persisted high-ID victim, and
  // fail-closed local transport; a 401/403-only result never earns the credit.
  const source = lines.join("\n");
  for (const needle of [
    'table.seedEmployer("ATTA"', 'table.seedEmployer("ATTB"',
    'table.seedEmployer("VICTIM"', 'table.seedEmployer("FILL" + i',
    "for (const actor of [a, b])",
    "assert.equal(after.subscriptions.length, 1)",
    "assert.deepEqual(after.payrollRuns, ownBefore[successCount].payrollRuns)",
    'noRealPaymongoOrMoneyMovement: true',
  ]) assert.ok(source.includes(needle),
    "BILLING_CREDIT_REFUSED: missing required real owned/foreign proof: " + needle);
  return receipt;
}

export function expectedBillingPostProof(read = readFileSync) {
  const r = readBillingPostReceipt(read);
  return {
    file: BILLING_POST_PROOF_FILE,
    line: r.methodProofAnchors.ownPositiveLine,
    ownPositiveLine: r.methodProofAnchors.ownPositiveLine,
    foreignDenialLine: r.methodProofAnchors.foreignDenialLine,
    forgedSelectorLine: r.methodProofAnchors.forgedSelectorLine,
    unchangedDbLine: r.methodProofAnchors.unchangedDbLine,
    victimIdOrderingLine: r.methodProofAnchors.orderingLine,
    proofBlobSha: r.inputBlobs[BILLING_POST_PROOF_FILE],
    routeBlobSha: r.inputBlobs[BILLING_POST_PATH],
    preloadFile: "scripts/qa/tenant-billing-paymongo-preload.mjs",
    preloadBlobSha: r.inputBlobs["scripts/qa/tenant-billing-paymongo-preload.mjs"],
    contractFile: "tests/tenant-billing-paymongo-contract.test.mjs",
    contractBlobSha: r.inputBlobs["tests/tenant-billing-paymongo-contract.test.mjs"],
    workflowFile: ".github/workflows/tenant-billing-paymongo-http.yml",
    workflowBlobSha: r.inputBlobs[".github/workflows/tenant-billing-paymongo-http.yml"],
    receiptFile: BILLING_POST_RECEIPT,
    receiptBlobSha: BILLING_POST_RECEIPT_SHA,
    sourceHead: r.sourceHead,
    workflowRunId: r.workflowRunId,
    workflowJobId: r.workflowJobId,
    evidence: "https://github.com/erwinmehehe/payrollph/actions/runs/" +
      r.workflowRunId + "/job/" + r.workflowJobId,
    proofPullRequest: 1900,
    evidenceLabel: r.label,
    postgresMajor: 16,
    methodActions: ["existing-subscription-update", "new-subscription-insert", "monthly", "annual"],
    independentOwnPositiveEmployers: 2,
    ownCheckout201: 2, foreign403: 2, forgedForeignSelectorsIgnored: true,
    victimBusinessAndAuditUnchanged: true, noRealPaymongoOrMoneyMovement: true,
    independentlyAccepted: false, independentSecurityReview: "PENDING",
    productionCertified: false,
    scope: "Two independently signed-in employer owners, real persisted higher-ID victim (>6 and > attacker IDs), owned 201 checkout on both existing-subscription and new-subscription paths; real foreign 403, forged victim subscription/invoice/entity selectors ignored, immutable victim billing/payroll/audit/outbox, blocked external PayMongo egress. Synthetic provider only, no charge, no subscription activation or production acceptance.",
  };
}

export function verifyBillingPostCredit(manifest, read = readFileSync) {
  const route = manifest.allApiRouteFiles[BILLING_POST_PATH];
  const method = route?.methods?.find(row => row.name === "POST");
  const expected = expectedBillingPostProof(read);
  assert.equal(route?.route, "billing");
  assert.equal(route.gitBlobSha, expected.routeBlobSha);
  assert.equal(method?.status, "COVERED", "BILLING_CREDIT_REFUSED: method not provisionally covered");
  assert.equal(method.reviewedUncertified, undefined);
  assert.deepEqual(method.testedBy, expected,
    "BILLING_CREDIT_REFUSED: exact reviewed proof receipt required");
  assert.equal(manifest.allApiRouteFiles[BILLING_POST_PATH].methods.find(m => m.name === "GET")
    ?.status, "COVERED", "Do not touch the separately proven billing GET");
  return 1;
}
