import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  BILLING_POST_PATH, BILLING_POST_RECEIPT, BILLING_POST_RECEIPT_SHA,
  expectedBillingPostProof, readBillingPostReceipt, verifyBillingPostCredit,
} from "../scripts/qa/tenant-billing-post-credit.mjs";
import { tallyTenantManifest, assertLiveTenantCounts, baseTenantManifest } from "./helpers/tenant-counts.mjs";

const manifest = () => JSON.parse(readFileSync(
  "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));

test("one sealed, actual two-owner PG16 checkout receipt supports only billing POST", () => {
  const m = manifest(), evidence = readBillingPostReceipt();
  assert.equal(BILLING_POST_RECEIPT_SHA.length, 40);
  assert.equal(evidence.sourceHead, "09f172f8280d345ed57decbe8a05aaf3a4e066e7");
  assert.equal(evidence.executedResult.ownCheckout201, 2);
  assert.equal(evidence.executedResult.foreign403, 2);
  assert.equal(evidence.executedResult.victimBusinessAndAuditUnchanged, true);
  assert.equal(evidence.executedResult.forgedForeignSelectorsIgnored, true);
  assert.equal(evidence.executedResult.noRealPaymongoOrMoneyMovement, true);
  assert.equal(evidence.executedResult.coverageCredits, 0, "original proof was uncredited");
  assert.equal(verifyBillingPostCredit(m), 1);
  assert.deepEqual(m.allApiRouteFiles[BILLING_POST_PATH].methods.find(x => x.name === "POST").testedBy,
    expectedBillingPostProof());
});

test("status-only, borrowed, mutated, disabled-provider-only and fake review fail closed", () => {
  const mutations = [
    (_m, r) => { r.status = "GAP"; },
    (_m, r) => { r.testedBy = null; },
    (_m, r) => { r.testedBy.ownCheckout201 = 0; },
    (_m, r) => { r.testedBy.foreign403 = 0; },
    (_m, r) => { r.testedBy.forgedForeignSelectorsIgnored = false; },
    (_m, r) => { r.testedBy.independentlyAccepted = true; },
    (_m, r) => { r.testedBy.sourceHead = "f".repeat(40); },
    (_m, r) => { r.testedBy.workflowRunId = 42789351153; },
    (_m, r) => { r.testedBy.workflowJobId = -1; },
    (_m, r) => { r.testedBy.proofBlobSha = "0".repeat(40); },
    (_m, r) => { r.testedBy.methodActions = ["provider-off-503"]; },
    (m) => { m.allApiRouteFiles[BILLING_POST_PATH].gitBlobSha = "1".repeat(40); },
    (m) => { m.allApiRouteFiles[BILLING_POST_PATH].methods.find(x => x.name === "GET").status = "GAP"; },
  ];
  for (const mutator of mutations) {
    const m = manifest(), row = m.allApiRouteFiles[BILLING_POST_PATH].methods.find(x => x.name === "POST");
    mutator(m, row);
    assert.throws(() => verifyBillingPostCredit(m));
  }
});

test("receipt/source/workflow/blob drift requires a fresh executed proof", () => {
  const receipt = readBillingPostReceipt();
  for (const file of [BILLING_POST_RECEIPT,...Object.keys(receipt.inputBlobs)]) {
    assert.throws(() => readBillingPostReceipt(path =>
      path === file ? Buffer.concat([readFileSync(path), Buffer.from("\n")]) : readFileSync(path)),
    undefined, "BILLING_CREDIT_REFUSED: tamper " + file);
  }
});

test("exactly one additional provisional billing credit; other GAPs and classes unchanged", () => {
  const m = manifest(), counts = tallyTenantManifest(m);
  assert.equal(m.metrics.methods, 498);
  assert.equal(m.metrics.coveredAfter, counts.coveredAfter);
  assert.equal(m.metrics.gap, counts.gap);
  assert.equal(m.metrics.publicByDesign, counts.publicByDesign);
  assert.equal(m.metrics.privilegedOperationsTokenOnly, counts.privilegedOperationsTokenOnly);
  assertLiveTenantCounts(assert, m);
  const base = baseTenantManifest();
  if (base) {
    const before = tallyTenantManifest(base.manifest);
    const old = base.manifest.allApiRouteFiles[BILLING_POST_PATH].methods.find(x => x.name === 'POST');
    const delta = old.status === 'GAP' ? 1 : 0;
    assert.equal(counts.coveredAfter - before.coveredAfter, delta, 'Exactly the billing method may gain credit');
    assert.equal(before.gap - counts.gap, delta, 'No unrelated GAP may disappear');
  }
  for (const [verb, route] of [
    ["PATCH", "approvals/[id]"],
    ["POST", "payroll-runs/[id]/exports"],
    ["POST", "payroll-runs/[id]/xendit-payout"],
    ["POST", "hcm/work-items/escalate"],
    ["GET", "marketing/leads"],
    ["POST", "automation-studio"],
    ["GET", "readiness/workspace"],
  ]) {
    const row = m.allApiRouteFiles["src/app/api/" + route + "/route.ts"].methods
      .find(x => x.name === verb);
    assert.equal(row.status, "GAP", verb + " " + route + " remains uncredited");
    assert.equal(row.testedBy, null);
  }
  assert.equal(m.allApiRouteFiles["src/app/api/bir/annual-employer/candidate/route.ts"]
    .methods[0].status, "COVERED", "BIR evidence is not this credit");
  assert.equal(m.allApiRouteFiles["src/app/api/compliance/filing-validations/[id]/route.ts"]
    .methods[0].status, "COVERED", "Filing evidence is not this credit");
  assert.equal(m.acceptanceStatus.startsWith('NOT ACCEPTED: ' + counts.gap + ' API methods'), true);
});
