import {readWageWithdrawalFixture} from './helpers/wage-renewal-fixture.mjs';
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {verifyMigrationPostCredit} from "../scripts/qa/tenant-migrations-post-credit.mjs";
import {verifySecurityCredits} from "../scripts/qa/tenant-security-write-credit.mjs";
import {verifyAllTransitiveWageHolds,TRANSITIVE_HOLD_KIND} from "../scripts/qa/wage-registry-transitive-source-hold.mjs";

const get=()=>readWageWithdrawalFixture();
const path="src/app/api/migrations/route.ts";
const methods=m=>m.allApiRouteFiles[path].methods;

test("both import methods carry exact source-verified 47-method wage hold, never stale migration credit",()=>{
 const m=get(),held=verifyAllTransitiveWageHolds(m);
 assert.equal(held.size,47);
 for(const row of methods(m)){
  assert.ok(held.has(row.name+" "+path));
  assert.equal(row.status,"GAP");
  assert.equal(row.testedBy,null);
  assert.equal(row.reviewedUncertified?.kind,TRANSITIVE_HOLD_KIND);
  assert.equal(row.reviewedUncertified.coverageCredits,0);
  assert.equal(row.reviewedUncertified.productionCertified,false);
  assert.ok(row.reviewedUncertified.priorProof,"Old four-kind proof stays exact and archived");
 }
 assert.throws(()=>verifyMigrationPostCredit(m),
   "The old four-kind migration receipt cannot cover changed wage-dependent imports");
});

test("fraudulent partial or reactivated migration method fails exact source hold",()=>{
 const m=get();
 for(const verb of ["GET","POST"])for(const mutate of [
   row=>{row.status="COVERED";},
   row=>{row.testedBy=structuredClone(row.reviewedUncertified.priorProof);},
   row=>{row.reviewedUncertified.coverageCredits=1;},
   row=>{row.reviewedUncertified.priorProof={file:"borrowed.mjs"};},
   row=>{row.reviewedUncertified.productionCertified=true;},
 ]) {
   const changed=structuredClone(m);mutate(methods(changed).find(x=>x.name===verb));
   assert.throws(()=>verifyAllTransitiveWageHolds(changed));
 }
});

test("changed wage-order source, watch or archived import proof fails closed",()=>{
 const m=get();
 for(const target of [
   "src/lib/wage-orders.ts","src/lib/statutory-rule-watch.ts",
   "scripts/qa/wage-registry-transitive-source-hold-archive.json",
 ]) assert.throws(()=>verifyAllTransitiveWageHolds(m,p=>{
   const v=readFileSync(p);
   return p===target?Buffer.concat([v,Buffer.from("drift")]):v;
 }),"Current or historical source drift must not be ignored: "+target);
});

test("migrations cannot borrow unrelated security-write or transfer method receipts",()=>{
 const m=get();
 assert.equal(verifySecurityCredits(m),3,"Unchanged developer/document security proofs retain distinct credit");
 const approvals=m.allApiRouteFiles["src/app/api/approvals/[id]/route.ts"].methods.find(x=>x.name==="PATCH");
 assert.equal(approvals.status,"GAP");
 assert.equal(approvals.testedBy,null);
 assert.equal(approvals.reviewedUncertified.kind,TRANSITIVE_HOLD_KIND);
 for(const verb of ["POST","PATCH"]){
   const t=m.allApiRouteFiles["src/app/api/multi-entity/transfers/route.ts"].methods.find(x=>x.name===verb);
   assert.equal(t.status,"COVERED");
   assert.equal(t.testedBy.file,"scripts/qa/tenant-transfers-http.mjs");
   assert.equal(t.testedBy.proofPullRequest,1853);
 }
});
