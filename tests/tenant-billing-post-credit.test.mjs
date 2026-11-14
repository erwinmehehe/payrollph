import {xenditPostCreditDelta,verifyXenditPostCredit} from '../scripts/qa/tenant-xendit-post-credit.mjs';
import {verifyOidcCallbackHold} from '../scripts/qa/tenant-oidc-source-supersession.mjs';
import { verifyArchitecturalRelabelDelta, yearEndHoldDelta, yearEndRenewalDelta } from './helpers/tenant-architectural-classification-delta.mjs';
import { oracleWithdrawalDelta,oracleRenewalDelta,reviewedOidcSourceSupersession } from './helpers/tenant-counts.mjs';
import {isVerifiedOracleRenewal} from '../scripts/qa/payroll-run-oracle-hold.mjs';
import { verifyOracleSourceHolds } from '../scripts/qa/payroll-run-oracle-hold.mjs';
import { verifyWorker360PageCredit } from "../scripts/qa/tenant-five-method-credit-verify.mjs";
import {verifyStudioPostCredit,STUDIO_POST_PATH} from '../scripts/qa/tenant-studio-post-credit.mjs';
import {verifyMkt01Credit} from '../scripts/qa/tenant-mkt01-marketing-credit.mjs';
import {ROUTE_PATH as READINESS_GET_PATH,verifyWorkspaceReadinessCredit} from '../scripts/qa/tenant-workspace-readiness-credit.mjs';
import {APPROVALS_PATH,verifyApprovalsCredit} from '../scripts/qa/tenant-approvals-credit.mjs';
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
  assert.equal(m.metrics.methods, counts.methods);
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
    const readyDelta=base.manifest.allApiRouteFiles[READINESS_GET_PATH].methods.find(x=>x.name==='GET').status==='GAP'?verifyWorkspaceReadinessCredit(m):0;
    const studioDelta=base.manifest.allApiRouteFiles[STUDIO_POST_PATH].methods.find(x=>x.name==='POST').status==='GAP'?verifyStudioPostCredit(m):0;
    const exportsDelta=base.manifest.allApiRouteFiles['src/app/api/payroll-runs/[id]/exports/route.ts'].methods.find(x=>x.name==='POST').status==='GAP' && m.allApiRouteFiles['src/app/api/payroll-runs/[id]/exports/route.ts'].methods.find(x=>x.name==='POST').status==='COVERED'?1:0;
    const approvalsDelta=base.manifest.allApiRouteFiles[APPROVALS_PATH].methods.find(x=>x.name==='PATCH').status==='GAP'?verifyApprovalsCredit(m):0;
    const yearEndHold = yearEndHoldDelta(base.manifest, m) - yearEndRenewalDelta(base.manifest, m);
    // The Worker 360 GET's organization-only receipt cannot credit its changed legal-employer source.
    const workerPath = "src/app/api/hcm/worker-360/route.ts";
    const formerWorker = base.manifest.allApiRouteFiles[workerPath].methods.find(x => x.name === "GET");
    const currentWorker = m.allApiRouteFiles[workerPath].methods.find(x => x.name === "GET");
    assert.equal(verifyWorker360LegalEmployerCredits(m),2);
    assert.equal(currentWorker.status, "COVERED");
    verifyWorker360PageCredit(m);
    const restoredWorkerCredit = formerWorker.status === "GAP" ? 1 : 0;
    const renewedExports=isVerifiedOracleRenewal(m,'src/app/api/payroll-runs/[id]/exports/route.ts','POST')?exportsDelta:0;
    const callback=m.allApiRouteFiles[OIDC_CALLBACK].methods[0];
    if(callback.status==='GAP')verifyOidcCallbackHold(m);
    const oidcDelta = base.manifest.allApiRouteFiles[OIDC_CALLBACK].methods[0].status === 'GAP' && callback.status==='COVERED' ? verifyOidcCallbackCredit(m) : 0;
    const oidcWithdrawal=reviewedOidcSourceSupersession(base.manifest,m).size;
    const mkt01Path="src/app/api/marketing/leads/route.ts";
    const mainMkt01=base.manifest.allApiRouteFiles[mkt01Path].methods.find(x=>x.name==="GET");
    const currentMkt01=m.allApiRouteFiles[mkt01Path].methods.find(x=>x.name==="GET");
    const mkt01Delta=mainMkt01.status==="GAP" && currentMkt01.status==="COVERED"
      ? verifyMkt01Credit(m) : 0;
    const expectedNetCredits=xenditPostCreditDelta(base.manifest,m)+delta+readyDelta+approvalsDelta+studioDelta+exportsDelta-renewedExports+restoredWorkerCredit+oidcDelta-oidcWithdrawal-yearEndHold-oracleWithdrawalDelta(base.manifest,m)+oracleRenewalDelta(base.manifest,m)+mkt01Delta;
    assert.equal(counts.coveredAfter - before.coveredAfter, expectedNetCredits, 'Only separately sealed credits and the exact Worker 360 demotion may change totals');
    const relabels=verifyArchitecturalRelabelDelta(assert,base.manifest,m);
    assert.equal(before.gap-counts.gap,expectedNetCredits+relabels.gapRelabels,'Only sealed credits, the reviewed Worker 360 demotion and source-pinned zero-credit classifications may alter GAPs');
    assert.equal(counts.publicByDesign-before.publicByDesign,relabels.publicByDesign);
    assert.equal(counts.privilegedOperationsTokenOnly-before.privilegedOperationsTokenOnly,relabels.privilegedTokenOnly);
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
    const path='src/app/api/'+route+'/route.ts';
    if(isVerifiedOracleRenewal(m,path,verb))continue;
    if(verifyOracleSourceHolds(m).has(verb+' '+path)){
      const held=m.allApiRouteFiles[path].methods.find(x=>x.name===verb);
      assert.equal(held.status,'GAP');assert.equal(held.testedBy,null);continue;
    }
    if(route==='automation-studio'){assert.equal(verifyStudioPostCredit(m),1);continue;}
    if(route==='marketing/leads'){
      assert.equal(verifyMkt01Credit(m),1,
        "MKT-01 operator GET must carry its own source-current PG16 receipt");
      continue;
    }
    if(route==='payroll-runs/[id]/xendit-payout'){assert.equal(verifyXenditPostCredit(m),1);continue;}
    if(route==='payroll-runs/[id]/exports'){const x=m.allApiRouteFiles['src/app/api/payroll-runs/[id]/exports/route.ts'].methods.find(y=>y.name==='POST');assert.equal(x.status,'COVERED');assert.equal(x.testedBy.file,'scripts/qa/tenant-payroll-exports-post-http.mjs');continue;}
    if(route==='readiness/workspace'){assert.equal(verifyWorkspaceReadinessCredit(m),1);continue;}
    if(route==='approvals/[id]'){assert.equal(verifyApprovalsCredit(m),1);continue;}
    const row = m.allApiRouteFiles["src/app/api/" + route + "/route.ts"].methods
      .find(x => x.name === verb);
    if(route==="hcm/work-items/escalate") {
      assert.equal(row.status,"PRIVILEGED-OPERATIONS-TOKEN-ONLY");
      assert.equal(row.privilegedOperation?.methodCoverageCredits,0);
      assert.equal(row.privilegedOperation?.credentialEnvironment,"HCM_SLA_CRON_SECRET");
    } else assert.equal(row.status,"GAP",verb+" "+route+" remains uncredited");
    assert.equal(row.testedBy, null);
  }
  assert.equal(m.allApiRouteFiles["src/app/api/bir/annual-employer/candidate/route.ts"]
    .methods[0].status, "COVERED", "BIR evidence is not this credit");
  assert.equal(m.allApiRouteFiles["src/app/api/compliance/filing-validations/[id]/route.ts"]
    .methods[0].status, "COVERED", "Filing evidence is not this credit");
  assert.equal(m.acceptanceStatus.startsWith('NOT ACCEPTED: ' + counts.gap + ' API methods'), true);
});
import {verifyWorker360LegalEmployerCredits} from '../scripts/qa/tenant-worker360-legal-employer-credit.mjs';

import {verifyOidcCallbackCredit, OIDC_CALLBACK} from '../scripts/qa/tenant-oidc-full-credit.mjs';
