/** Immutable 5-method historical source-seal withdrawal; never a current tenant credit. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
export const SEALED_WAGE_HOLD_KIND="wage-registry-global-source-seal-withdrawal";
export const SEALED_WAGE_HOLD_ARCHIVE="scripts/qa/wage-registry-sealed-receipt-source-hold-archive.json";
export const SEALED_WAGE_HOLD_ARCHIVE_SHA="1313f8df4cb53707ec449671aa5875f0418cba6c";
const WAGE="src/lib/wage-orders.ts",WATCH="src/lib/statutory-rule-watch.ts";
const OLD="2ea37036211a846ff515540d6b982760df8db1eb",NEW="0bb8c55d6cad0f3a22f6096f0937dd55ca0b227d",WATCH_NEW="0032da010a8065d415415d50f0353a7a430e12fb";
const RECEIPTS=Object.freeze({
 "scripts/qa/tenant-enterprise-admin-credit-receipt.json":"fb35fef200ca7f0d7d3dd8b8797cafc4d299407f",
 "scripts/qa/tenant-studio-post-credit-receipt.json":"f75b1436996f98ffe40be2f0a785700530583e0e",
 "scripts/qa/tenant-spend-managed-receipt.json":"9d3e13cb5f2de79a9aa9c5f9c56a2b61ee27c8f5",
});
const blob=raw=>{const b=Buffer.from(raw);return createHash("sha1").update("blob "+b.length+"\0").update(b).digest("hex");};
export function readSealedWageHoldArchive(read=readFileSync){
 const raw=read(SEALED_WAGE_HOLD_ARCHIVE);
 assert.equal(blob(raw),SEALED_WAGE_HOLD_ARCHIVE_SHA,"Sealed wage archive changed");
 const a=JSON.parse(raw);
 assert.equal(a.schema,"wage-registry-broad-sealed-receipt-source-withdrawal-v1");
 assert.equal(a.reviewedBaseCommit,"2459b9aa15c21b301e9ff8cc81dca2e679fed055");
 assert.equal(a.reviewedSourceCommit,"35f110c0b4657a88f037a3fe579f30012955219c");
 assert.equal(a.baseManifestGitBlobSha,"a62f967f58563979243e651e2c7e952a8a45c8bc");
 assert.equal(a.reviewedManifestGitBlobSha,"efa6a99f7f61b521f369fb2f42852e729d711313");
 assert.equal(a.methodCount,5);assert.equal(a.methods.length,5);
 assert.equal(a.sourceBefore,OLD);assert.equal(a.sourceAfter,NEW);
 assert.equal(a.coverageCredits,0);assert.equal(a.execution,"NOT_RUN");
 assert.equal(a.independentSecurityReview,"PENDING");assert.equal(a.productionCertified,false);
 assert.equal(new Set(a.methods.map(e=>e.verb+" "+e.path)).size,5);
 return a;
}
export function sealedWageHoldRecord(e){
 return{kind:SEALED_WAGE_HOLD_KIND,sourceBefore:OLD,sourceAfter:NEW,
   receiptFile:e.receiptFile,receiptBlobSha:RECEIPTS[e.receiptFile],
   routeBlobSha:e.routeBlobSha,historicalArchiveSha:SEALED_WAGE_HOLD_ARCHIVE_SHA,
   priorProof:e.priorProof,coverageCredits:0,execution:"NOT_RUN",
   independentSecurityReview:"PENDING",productionCertified:false};
}
export function sealedWageHoldReason(e){
 return "HELD / ZERO CREDITS: "+e.receiptFile+" executed the historical wage-order source "+
   OLD+"; full source-sealed proof does not cover the updated wage registry. "+
   "Old receipt archived only. Fresh exact-source disposable PG16 real-HTTP method "+
   "proof and independent review required; not accepted for production.";
}
export function verifyAllSealedWageHolds(m,read=readFileSync){
 const a=readSealedWageHoldArchive(read);
 assert.equal(blob(read(WAGE)),NEW,"Wage source changed again");
 assert.equal(blob(read(WATCH)),WATCH_NEW,"Statutory source changed again");
 const actual=Object.entries(m.allApiRouteFiles).flatMap(([path,file])=>file.methods
   .filter(row=>row.reviewedUncertified?.kind===SEALED_WAGE_HOLD_KIND).map(row=>row.name+" "+path));
 const expected=a.methods.map(e=>e.verb+" "+e.path);
 assert.equal(actual.length,5);assert.deepEqual(actual.slice().sort(),expected.slice().sort());
 for(const e of a.methods){
  const receipt=read(e.receiptFile);
  assert.equal(blob(receipt),RECEIPTS[e.receiptFile],"Old executed receipt altered");
  assert.equal((JSON.parse(receipt).pins||JSON.parse(receipt).inputBlobs||JSON.parse(receipt).inputs)?.[WAGE],OLD);
  const file=m.allApiRouteFiles[e.path],row=file?.methods.find(x=>x.name===e.verb);
  assert.equal(file?.gitBlobSha,e.routeBlobSha);
  assert.equal(row?.status,"GAP");assert.equal(row.testedBy,null);
  assert.deepEqual(row.reviewedUncertified,sealedWageHoldRecord(e));
  assert.equal(row.reason,sealedWageHoldReason(e));
 }
 return new Set(expected);
}
export function reviewedSealedWageWithdrawals(before,after,read=readFileSync){
 const count=Object.values(after.allApiRouteFiles).flatMap(f=>f.methods)
   .filter(x=>x.reviewedUncertified?.kind===SEALED_WAGE_HOLD_KIND).length;
 if(count===0)return new Set();
 const a=readSealedWageHoldArchive(read),held=verifyAllSealedWageHolds(after,read);
 for(const e of a.methods){
  const file=before.allApiRouteFiles[e.path],old=file?.methods.find(x=>x.name===e.verb);
  assert.equal(file?.gitBlobSha,e.routeBlobSha);
  assert.equal(old?.status,"COVERED");
  assert.deepEqual(old.testedBy,e.priorProof);
 }
 return held;
}
export function historicSealedWageProofView(m,read=readFileSync){
 const count=Object.values(m.allApiRouteFiles).flatMap(f=>f.methods)
   .filter(x=>x.reviewedUncertified?.kind===SEALED_WAGE_HOLD_KIND).length;
 if(count===0)return m;
 assert.equal(count,5);
 const a=readSealedWageHoldArchive(read);verifyAllSealedWageHolds(m,read);
 const view=structuredClone(m);
 for(const e of a.methods){
  const row=view.allApiRouteFiles[e.path].methods.find(x=>x.name===e.verb);
  row.status="COVERED";row.testedBy=structuredClone(e.priorProof);
  delete row.reviewedUncertified;
  row.reason="HISTORICAL VIEW ONLY: prior source-sealed receipt; current source HELD.";
 }
 view.metrics.coveredAfter+=5;view.metrics.gap-=5;
 view.acceptanceStatus=view.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/,"NOT ACCEPTED: "+view.metrics.gap+" API methods");
 return view;
}
