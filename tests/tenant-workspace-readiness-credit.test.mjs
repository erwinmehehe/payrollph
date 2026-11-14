import {xenditPostCreditDelta} from '../scripts/qa/tenant-xendit-post-credit.mjs';
import {oidcStartCreditDelta} from '../scripts/qa/tenant-oidc-batch-credit-verify.mjs';
import {verifyOidcCallbackHold} from '../scripts/qa/tenant-oidc-source-supersession.mjs';
import { verifyArchitecturalRelabelDelta, yearEndHoldDelta, yearEndRenewalDelta } from './helpers/tenant-architectural-classification-delta.mjs';
import { verifyWorker360PageCredit } from "../scripts/qa/tenant-five-method-credit-verify.mjs";
import { historicWorker360ProofView, verifyCurrentScopedPageGapCount } from "../scripts/qa/tenant-five-scoped-page-credit.mjs";
import {verifyStudioPostCredit,STUDIO_POST_PATH} from '../scripts/qa/tenant-studio-post-credit.mjs';
import {verifyApprovalsCredit,APPROVALS_PATH} from '../scripts/qa/tenant-approvals-credit.mjs';
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertLiveTenantCounts, baseTenantManifest } from "./helpers/tenant-counts.mjs";
import {verifyCheckoutCredit} from '../scripts/qa/tenant-billing-checkout-credit.mjs';
import {
  ROUTE_PATH, RECEIPT_FILE, expectedWorkspaceReadinessTestedBy,
  verifyWorkspaceReadinessReceipt, verifyWorkspaceReadinessCredit,
} from "../scripts/qa/tenant-workspace-readiness-credit.mjs";

const manifest = () => JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const clone = x => structuredClone(x);

test("one readiness GET recovery uses exact merged, executed PG16 HTTP evidence", () => {
  const r = verifyWorkspaceReadinessReceipt();
  assert.equal(r.workflowRunId, 42814903331);
  assert.equal(r.workflowJobId, 129825397604);
  assert.equal(r.proofHeadSha, "7b46658a7ea9f5eee86662cf35d7ca1730b7b5f4");
  assert.deepEqual([r.logResult.ownSuccesses, r.logResult.foreignDenials,
    r.logResult.negativeChecks], [3, 4, 15]);
  assert.equal(r.logResult.allBusinessVictimIdsOverSix, true);
  assert.equal(r.logResult.sqlStateUnchanged, true);
  assert.equal(r.securityReview, "PENDING_INDEPENDENT_REVIEW");
  assert.equal(r.productionCertified, false);
  const m = manifest();
  assert.equal(verifyWorkspaceReadinessCredit(m), 1);
  assertLiveTenantCounts(assert, m);
  assert.equal(verifyCurrentScopedPageGapCount(m), 11);
  const base=baseTenantManifest();
  if(base){const studioDelta=base.manifest.allApiRouteFiles[STUDIO_POST_PATH].methods.find(x=>x.name==='POST').status==='GAP'?verifyStudioPostCredit(m):0;const approvalDelta=base.manifest.allApiRouteFiles[APPROVALS_PATH].methods.find(x=>x.name==='PATCH').status==='GAP'?verifyApprovalsCredit(m):0;const delta=base.manifest.allApiRouteFiles[ROUTE_PATH].methods[0].status==='GAP'?1:0;const exportsDelta=base.manifest.allApiRouteFiles['src/app/api/payroll-runs/[id]/exports/route.ts'].methods.find(x=>x.name==='POST').status==='GAP' && m.allApiRouteFiles['src/app/api/payroll-runs/[id]/exports/route.ts'].methods.find(x=>x.name==='POST').status==='COVERED'?1:0;
    const yearEndHold=yearEndHoldDelta(base.manifest,m)-yearEndRenewalDelta(base.manifest,m);
    // The Worker 360 GET's organization-only receipt cannot credit its changed legal-employer source.
    const workerPath = "src/app/api/hcm/worker-360/route.ts";
    const formerWorker = base.manifest.allApiRouteFiles[workerPath].methods.find(x => x.name === "GET");
    const currentWorker = m.allApiRouteFiles[workerPath].methods.find(x => x.name === "GET");
    // The original Worker 360 source verifier was sealed at 16 page gaps.
    // Preserve its historical view without downgrading the five new live credits.
    const historicalWorker360 = historicWorker360ProofView(m);
    assert.equal(verifyWorker360LegalEmployerCredits(historicalWorker360),2);
    assert.equal(currentWorker.status, "COVERED");
    assert.equal(verifyWorker360PageCredit(historicalWorker360), 16);
    const restoredWorkerCredit = formerWorker.status === "GAP" ? 1 : 0;
    const renewedExports=isVerifiedOracleRenewal(m,'src/app/api/payroll-runs/[id]/exports/route.ts','POST')?exportsDelta:0;
    const callback=m.allApiRouteFiles[OIDC_CALLBACK].methods[0];
    if(callback.status==='GAP')verifyOidcCallbackHold(m);
    const oidcDelta = base.manifest.allApiRouteFiles[OIDC_CALLBACK].methods[0].status === 'GAP' && callback.status==='COVERED' ? verifyOidcCallbackCredit(m) : 0;
    const oidcWithdrawal=reviewedOidcSourceSupersession(base.manifest,m).size;
    const expectedNetCredits=oidcStartCreditDelta(base.manifest,m)+xenditPostCreditDelta(base.manifest,m)+delta+approvalDelta+studioDelta+exportsDelta-renewedExports+restoredWorkerCredit+oidcDelta-oidcWithdrawal-yearEndHold-oracleWithdrawalDelta(base.manifest,m)+oracleRenewalDelta(base.manifest,m);
    assert.equal(m.metrics.coveredAfter-base.manifest.metrics.coveredAfter,expectedNetCredits);
    const relabels=verifyArchitecturalRelabelDelta(assert,base.manifest,m);
    assert.equal(base.manifest.metrics.gap-m.metrics.gap,expectedNetCredits+relabels.gapRelabels);
    assert.equal(m.metrics.publicByDesign-base.manifest.metrics.publicByDesign,relabels.publicByDesign);
    assert.equal(m.metrics.privilegedOperationsTokenOnly-base.manifest.metrics.privilegedOperationsTokenOnly,relabels.privilegedTokenOnly);}
  assert.equal(m.allApiRouteFiles[ROUTE_PATH].methods[0].testedBy.coverageCredits, 1);
  assert.deepEqual(m.allApiRouteFiles[ROUTE_PATH].methods[0].testedBy,
    expectedWorkspaceReadinessTestedBy());
});

test("fail closed on status-only, altered source pins, borrowed receipt and false acceptance", () => {
  const original = manifest();
  const mutate = change => {
    const m = clone(original); change(m);
    assert.throws(() => verifyWorkspaceReadinessCredit(m));
  };
  mutate(m => { m.allApiRouteFiles[ROUTE_PATH].methods[0].status = "GAP"; });
  mutate(m => { m.allApiRouteFiles[ROUTE_PATH].methods[0].testedBy.workflowRunId = 1; });
  mutate(m => { m.allApiRouteFiles[ROUTE_PATH].methods[0].testedBy.proofBlobSha = "0".repeat(40); });
  mutate(m => { m.allApiRouteFiles[ROUTE_PATH].methods[0].testedBy.independentlyAccepted = true; });
  mutate(m => { m.allApiRouteFiles[ROUTE_PATH].methods[0].testedBy.productionTested = true; });
  mutate(m => { m.allApiRouteFiles[ROUTE_PATH].methods[0].testedBy.negativeChecks = 8; });
  mutate(m => { m.allApiRouteFiles[ROUTE_PATH].methods[0].reviewedUncertified = {}; });
  mutate(m => { m.allApiRouteFiles[ROUTE_PATH].gitBlobSha = "0".repeat(40); });
  mutate(m => { m.allApiRouteFiles["src/app/api/billing/route.ts"].methods[0].testedBy = {
    receiptFile: RECEIPT_FILE,
  }; });
});

test("fabricated or stale receipt, test harness, runtime route, loader and workflow are rejected", () => {
  const m = manifest();
  const r = verifyWorkspaceReadinessReceipt();
  for (const path of [RECEIPT_FILE, ...Object.keys(r.sourceBlobs)]) {
    const read = name => name === path
      ? Buffer.concat([readFileSync(name), Buffer.from("\n// tampered")])
      : readFileSync(name);
    assert.throws(() => verifyWorkspaceReadinessReceipt(read),
      undefined, "Source drift must require a new PG16 receipt: " + path);
    assert.throws(() => verifyWorkspaceReadinessCredit(m, read),
      undefined, "Modified source must invalidate the method credit: " + path);
  }
});

test("the readiness receipt does not credit sibling or unrelated GAP families", () => {
  const m = manifest();
  for (const [route, verb] of [
    ["src/app/api/billing/route.ts", "POST"],
    ["src/app/api/automation-studio/route.ts", "POST"],
    ["src/app/api/approvals/[id]/route.ts", "PATCH"],
    ["src/app/api/payroll-runs/[id]/exports/route.ts", "POST"],
  ]) {
    if(isVerifiedOracleRenewal(m,route,verb))continue;
    if(verifyOracleSourceHolds(m).has(verb+' '+route)){
      const held=m.allApiRouteFiles[route].methods.find(x=>x.name===verb);
      assert.equal(held.status,'GAP');assert.equal(held.testedBy,null);continue;
    }
    if(route===STUDIO_POST_PATH){assert.equal(verifyStudioPostCredit(m),1);continue;}
    if(route==='src/app/api/billing/route.ts'){assert.equal(verifyCheckoutCredit(m),1);continue;}
    if(route===APPROVALS_PATH){assert.equal(verifyApprovalsCredit(m),1);continue;}
    if(route==='src/app/api/payroll-runs/[id]/exports/route.ts'){const x=m.allApiRouteFiles[route].methods.find(y=>y.name==='POST');assert.equal(x.status,'COVERED');assert.equal(x.testedBy.file,'scripts/qa/tenant-payroll-exports-post-http.mjs');continue;}
    const method = m.allApiRouteFiles[route].methods.find(x => x.name === verb);
    assert.equal(method.status, "GAP", route);
    assert.equal(method.testedBy, null, route);
  }
  assert.equal(m.allApiRouteFiles[ROUTE_PATH].methods[0].testedBy.productionTested, false);
  assert.equal(m.allApiRouteFiles[ROUTE_PATH].methods[0].testedBy.launchApproved, false);
});
import { oracleWithdrawalDelta,oracleRenewalDelta,reviewedOidcSourceSupersession } from './helpers/tenant-counts.mjs';
import {isVerifiedOracleRenewal} from '../scripts/qa/payroll-run-oracle-hold.mjs';
import { verifyOracleSourceHolds } from '../scripts/qa/payroll-run-oracle-hold.mjs';
import {verifyWorker360LegalEmployerCredits} from '../scripts/qa/tenant-worker360-legal-employer-credit.mjs';

import {verifyOidcCallbackCredit, OIDC_CALLBACK} from '../scripts/qa/tenant-oidc-full-credit.mjs';
