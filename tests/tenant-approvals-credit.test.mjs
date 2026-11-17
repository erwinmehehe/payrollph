import {readWageWithdrawalFixture} from './helpers/wage-renewal-fixture.mjs';
import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {APPROVALS_PATH,verifyApprovalsCredit,approvalEvidence} from "../scripts/qa/tenant-approvals-credit.mjs";
import {verifyAllTransitiveWageHolds,TRANSITIVE_HOLD_KIND} from "../scripts/qa/wage-registry-transitive-source-hold.mjs";

const load=()=>readWageWithdrawalFixture();
const method=m=>m.allApiRouteFiles[APPROVALS_PATH].methods.find(x=>x.name==="PATCH");

test("seven historical approvals jobs cannot recredit wage-dependent PATCH without new evidence",()=>{
 const m=load(),held=verifyAllTransitiveWageHolds(m),row=method(m);
 assert.ok(held.has("PATCH "+APPROVALS_PATH));
 assert.equal(row.status,"GAP");
 assert.equal(row.testedBy,null);
 assert.equal(row.reviewedUncertified.kind,TRANSITIVE_HOLD_KIND);
 assert.equal(row.reviewedUncertified.coverageCredits,0);
 assert.equal(row.reviewedUncertified.productionCertified,false);
 assert.ok(row.reviewedUncertified.priorProof,"Original executed receipt remains immutable");
 const previous=JSON.parse(readFileSync("scripts/qa/tenant-approvals-recovery-receipt.json","utf8"));
 assert.equal(previous.jobs.length,7);
 for(const job of previous.jobs)assert.equal(job.result,"success");
 assert.throws(()=>verifyApprovalsCredit(m),"Old source-matched approvals receipt is no longer current");
});

test("changed original approvals source or archived evidence cannot silently be reused",()=>{
 const m=load();
 for(const target of [
  "src/lib/wage-orders.ts","src/lib/statutory-rule-watch.ts",
  "scripts/qa/wage-registry-transitive-source-hold-archive.json",
 ])assert.throws(()=>verifyAllTransitiveWageHolds(m,p=>{
  const v=readFileSync(p);
  return p===target?Buffer.concat([v,Buffer.from("tampered")]):v;
 }),target+": exact old-source withdrawal required");
});

test("borrowed, partial, or active approvals receipt cannot pass the current hold",()=>{
 const m=load();
 for(const mutate of [
  row=>{row.status="COVERED";},
  row=>{row.testedBy=structuredClone(row.reviewedUncertified.priorProof);},
  row=>{row.reviewedUncertified.coverageCredits=1;},
  row=>{row.reviewedUncertified.priorProof={file:"borrowed.mjs"};},
  row=>{row.reviewedUncertified.independentSecurityReview="APPROVED";},
 ]) {
  const forged=structuredClone(m);mutate(method(forged));
  assert.throws(()=>verifyAllTransitiveWageHolds(forged),
    "The current wage-source hold must fail closed on any modified approval");
 }
});
