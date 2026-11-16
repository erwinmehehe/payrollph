import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {
 SEALED_WAGE_HOLD_KIND,SEALED_WAGE_HOLD_ARCHIVE,
 readSealedWageHoldArchive,verifyAllSealedWageHolds,reviewedSealedWageWithdrawals
} from "../scripts/qa/wage-registry-sealed-receipt-source-hold.mjs";
import {historicWageRegistryProofView} from "../scripts/qa/wage-registry-source-hold.mjs";
import {verifySsoResolveClassification} from '../scripts/qa/tenant-sso-resolve-public-classification.mjs';
const manifest=()=>JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json","utf8"));
test("five broad exact-source receipts remain zero-credit and held",()=>{
 const m=manifest(),a=readSealedWageHoldArchive();
 assert.equal(verifyAllSealedWageHolds(m).size,5);
 const publicResolve=m.allApiRouteFiles['src/app/api/auth/sso/resolve/route.ts'].methods[0].status==='PUBLIC-BY-DESIGN'?verifySsoResolveClassification(m):0;
 assert.deepEqual([m.metrics.coveredAfter,m.metrics.gap,m.metrics.publicByDesign],[386,76-publicResolve,24+publicResolve]);
 const old=historicWageRegistryProofView(m);
 assert.equal(old.metrics.coveredAfter,m.metrics.coveredAfter+75);
 assert.equal(old.metrics.gap,m.metrics.gap-75);
 for(const e of a.methods){
  const now=m.allApiRouteFiles[e.path].methods.find(x=>x.name===e.verb);
  const before=old.allApiRouteFiles[e.path].methods.find(x=>x.name===e.verb);
  assert.equal(now.status,"GAP");assert.equal(now.testedBy,null);
  assert.equal(now.reviewedUncertified.kind,SEALED_WAGE_HOLD_KIND);
  assert.equal(now.reviewedUncertified.coverageCredits,0);
  assert.equal(now.reviewedUncertified.execution,"NOT_RUN");
  assert.equal(now.reviewedUncertified.productionCertified,false);
  assert.equal(before.status,"COVERED");
  assert.deepEqual(before.testedBy,e.priorProof);
 }
 assert.equal(reviewedSealedWageWithdrawals(old,m).size,5);
 assert.equal(reviewedSealedWageWithdrawals(old,old).size,0);
});
test("invented approval, removed hold or changed archive fails closed",()=>{
 const m=manifest(),e=readSealedWageHoldArchive().methods[0];
 const row=m.allApiRouteFiles[e.path].methods.find(x=>x.name===e.verb);
 row.status="COVERED";
 assert.throws(()=>verifyAllSealedWageHolds(m));
 row.status="GAP";row.testedBy=e.priorProof;
 assert.throws(()=>verifyAllSealedWageHolds(m));
 row.testedBy=null;row.reviewedUncertified.coverageCredits=1;
 assert.throws(()=>verifyAllSealedWageHolds(m));
 const altered=path=>path===SEALED_WAGE_HOLD_ARCHIVE
  ?Buffer.concat([readFileSync(path),Buffer.from("\n")]):readFileSync(path);
 assert.throws(()=>readSealedWageHoldArchive(altered),/archive changed/);
});
