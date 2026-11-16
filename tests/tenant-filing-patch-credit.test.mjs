import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {withFilingStatusBanner,verifyFilingPatchCredit,FILING_PATH,RECEIPT_FILE} from "../scripts/qa/tenant-filing-patch-credit.mjs";
import {verifyAllTransitiveWageHolds,TRANSITIVE_HOLD_KIND} from "../scripts/qa/wage-registry-transitive-source-hold.mjs";
import {verifyAllSealedWageHolds,SEALED_WAGE_HOLD_KIND} from "../scripts/qa/wage-registry-sealed-receipt-source-hold.mjs";

const get=()=>JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json","utf8"));
const row=(m,path=FILING_PATH,verb="PATCH")=>m.allApiRouteFiles[path].methods.find(x=>x.name===verb);

test("historic filing banner remains idempotent and keeps earlier evidence text",()=>{
 const m=get().metrics, history="> **PR #1891 BIR receipt — retain unchanged**\n\n# Frozen queue\n";
 const stale="> **SOLO_VERIFIED_DEV_RECOVERY — filing PATCH proposal, NOT production acceptance:** old wording and counts\n\n";
 const expected=withFilingStatusBanner(history,m,16);
 for(const text of [history,stale+history,stale+stale+history,expected]){
  const current=withFilingStatusBanner(text,m,16);
  assert.equal(current,expected);
  assert.equal(withFilingStatusBanner(current,m,16),current);
  assert.ok(current.endsWith(history));
  assert.ok(current.includes("16 page/action gaps remain"));
 }
 assert.ok(withFilingStatusBanner(expected,m,15).includes("15 page/action gaps remain"));
});

test("original three-leg filing receipt remains historical; changed wage source keeps PATCH GAP",()=>{
 const m=get(),held=verifyAllTransitiveWageHolds(m),method=row(m);
 assert.equal(held.size,47);
 assert.ok(held.has("PATCH "+FILING_PATH));
 assert.equal(method.status,"GAP");
 assert.equal(method.testedBy,null);
 assert.equal(method.reviewedUncertified?.kind,TRANSITIVE_HOLD_KIND);
 assert.equal(method.reviewedUncertified.coverageCredits,0);
 assert.equal(method.reviewedUncertified.productionCertified,false);
 const original=method.reviewedUncertified.priorProof;
 assert.equal(original.proofPullRequest,1885);
 assert.equal(original.workflowRunId,42728601391);
 assert.equal(original.independentlyAccepted,false);
 const receipt=JSON.parse(readFileSync(RECEIPT_FILE,"utf8"));
 assert.equal(receipt.jobs.accepted,129540561266);
 assert.equal(receipt.jobs.rejected,129540561557);
 assert.equal(receipt.jobs.guards,129540561580);
 assert.equal(receipt.accepted.realOwnAccepted200,2);
 assert.equal(receipt.rejectedLeg.actualOwnWrites,2);
 assert.equal(receipt.guards.boundedDenials,20);
 assert.throws(()=>verifyFilingPatchCredit(m),
   "Old successful HTTP proof cannot certify the changed wage dependency");
});

test("partial, borrowed, mutated, or reactivated filing receipt fails the exact 47-method guard",()=>{
 const m=get();
 for(const mutate of [
  v=>{v.status="COVERED";},
  v=>{v.testedBy=structuredClone(v.reviewedUncertified.priorProof);},
  v=>{v.reviewedUncertified.coverageCredits=1;},
  v=>{v.reviewedUncertified.priorProof={file:"borrowed.mjs"};},
  v=>{v.reviewedUncertified.productionCertified=true;},
  v=>{v.reviewedUncertified.dependencyChain=[];},
 ]){
  const copy=structuredClone(m);mutate(row(copy));
  assert.throws(()=>verifyAllTransitiveWageHolds(copy));
 }
 for(const target of [
  "src/lib/wage-orders.ts","src/lib/statutory-rule-watch.ts",
  "scripts/qa/wage-registry-transitive-source-hold-archive.json",
 ]) assert.throws(()=>verifyAllTransitiveWageHolds(m,p=>{
  const value=readFileSync(p);
  return p===target?Buffer.concat([value,Buffer.from("drift")]):value;
 }),"Original 47-method source closure cannot be altered: "+target);
});

test("filing, approvals and BIR holds remain disjoint from unrelated billing/MKT method credits",()=>{
 const m=get(),held=verifyAllTransitiveWageHolds(m);
 for(const [path,verb] of [
  [FILING_PATH,"PATCH"],
  ["src/app/api/approvals/[id]/route.ts","PATCH"],
  ["src/app/api/bir/annual-employer/candidate/route.ts","POST"],
 ]){
  const method=row(m,path,verb);
  assert.ok(held.has(verb+" "+path));
  assert.equal(method.status,"GAP");
  assert.equal(method.testedBy,null);
  assert.equal(method.reviewedUncertified.kind,TRANSITIVE_HOLD_KIND);
 }
 const studio=m.allApiRouteFiles["src/app/api/automation-studio/route.ts"].methods.find(x=>x.name==="POST");
 assert.equal(verifyAllSealedWageHolds(m).size,5);
 assert.equal(studio.status,"GAP");
 assert.equal(studio.reviewedUncertified.kind,SEALED_WAGE_HOLD_KIND);
 assert.equal(studio.testedBy,null);
 const marketing=m.allApiRouteFiles["src/app/api/marketing/leads/route.ts"].methods.find(x=>x.name==="GET");
 assert.equal(marketing.status,"COVERED");
 assert.equal(marketing.testedBy.operatorScoped,true);
 const billing=m.allApiRouteFiles["src/app/api/billing/route.ts"].methods.find(x=>x.name==="POST");
 assert.equal(billing.status,"COVERED");
 assert.equal(billing.testedBy.workflowRunId,42809117765);
});
