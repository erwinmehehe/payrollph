/** Zero-credit transitive wage-source withdrawal; historical proof is not current approval. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";

export const TRANSITIVE_HOLD_ARCHIVE="scripts/qa/wage-registry-transitive-source-hold-archive.json";
export const TRANSITIVE_HOLD_ARCHIVE_SHA="b120f0e6aa4f026f0868b79fd0678ea54cddbf8b";
export const TRANSITIVE_HOLD_KIND="wage-registry-transitive-dependency-source-withdrawal";
export const WAGE_TRANSITIVE_HELD_COUNT=47;
const WAGE_FILE="src/lib/wage-orders.ts", WATCH_FILE="src/lib/statutory-rule-watch.ts";
const WAGE_BLOB="0bb8c55d6cad0f3a22f6096f0937dd55ca0b227d";
const WATCH_BLOB="0032da010a8065d415415d50f0353a7a430e12fb";
const blob=raw=>{const b=Buffer.from(raw);return createHash("sha1").update("blob "+b.length+"\0").update(b).digest("hex");};
export function readTransitiveWageHoldArchive(read=readFileSync){
  const raw=read(TRANSITIVE_HOLD_ARCHIVE);
  assert.equal(blob(raw),TRANSITIVE_HOLD_ARCHIVE_SHA,"Transitive wage archive modified");
  const a=JSON.parse(raw);
  assert.equal(a.schema,"payrollph-wage-transitive-47-method-zero-credit-withdrawal-v1");
  assert.equal(a.reviewedBaseCommit,"2459b9aa15c21b301e9ff8cc81dca2e679fed055");
  assert.equal(a.reviewedSourceCommit,"2f37390e66b749454a29fcb17f877f214c9a81ae");
  assert.equal(a.baseManifestGitBlobSha,"a62f967f58563979243e651e2c7e952a8a45c8bc");
  assert.equal(a.reviewedManifestGitBlobSha,"86b932c7bfe00a0fcad3ca8797feee00fd45e5b3");
  assert.equal(a.sourceAfter,WAGE_BLOB);assert.equal(a.watchAfter,WATCH_BLOB);
  assert.equal(a.methodCount,47);assert.equal(a.methods.length,47);
  assert.equal(a.coverageCredits,0);assert.equal(a.execution,"NOT_RUN");
  assert.equal(a.productionCertified,false);assert.equal(a.independentSecurityReview,"PENDING");
  assert.equal(new Set(a.methods.map(x=>x.verb+" "+x.path)).size,47);
  for(const x of a.methods){
    assert.equal(x.dependencyChain[0],x.path);
    assert.ok([WAGE_FILE,WATCH_FILE].includes(x.dependencyChain.at(-1)));
    assert.ok(x.dependencyChain.length>=2);
    assert.match(x.routeBlobSha,/^[a-f0-9]{40}$/);
    assert.ok(x.priorProof&&typeof x.priorProof==="object");
  }
  return a;
}
export function transitiveWageHoldRecord(e){
  return {
    kind:TRANSITIVE_HOLD_KIND,
    sourceBefore:"2ea37036211a846ff515540d6b982760df8db1eb",
    sourceAfter:WAGE_BLOB,
    watchBefore:"0393d836eeee5874a85df4ba571bc4456f47a4ef",
    watchAfter:WATCH_BLOB,
    dependencyChain:e.dependencyChain,
    routeBlobSha:e.routeBlobSha,
    historicalArchiveSha:TRANSITIVE_HOLD_ARCHIVE_SHA,
    priorProof:e.priorProof,
    coverageCredits:0,
    execution:"NOT_RUN",
    independentSecurityReview:"PENDING",
    productionCertified:false
  };
}
export function transitiveWageHoldReason(e){
  return "HELD / ZERO CREDITS: changed NWPC wage source is imported transitively via "+
    e.dependencyChain.join(" -> ")+
    "; the archived provisional tenant proof is historical only. Current-source real-HTTP PG16 method evidence and independent security review are pending; not accepted for production.";
}
export function verifyAllTransitiveWageHolds(m,read=readFileSync){
  const a=readTransitiveWageHoldArchive(read);
  assert.equal(blob(read(WAGE_FILE)),WAGE_BLOB,"Unreviewed wage source changed again");
  assert.equal(blob(read(WATCH_FILE)),WATCH_BLOB,"Unreviewed statutory watch changed again");
  const seen=Object.entries(m.allApiRouteFiles).flatMap(([path,file])=>
    file.methods.filter(row=>row.reviewedUncertified?.kind===TRANSITIVE_HOLD_KIND)
      .map(row=>row.name+" "+path));
  const expected=a.methods.map(e=>e.verb+" "+e.path);
  assert.equal(seen.length,47);
  assert.deepEqual(seen.slice().sort(),expected.slice().sort());
  for(const e of a.methods){
    const file=m.allApiRouteFiles[e.path],row=file?.methods.find(x=>x.name===e.verb);
    assert.equal(file?.gitBlobSha,e.routeBlobSha);
    assert.equal(row?.status,"GAP",e.verb+" "+e.path);
    assert.equal(row.testedBy,null);
    assert.deepEqual(row.reviewedUncertified,transitiveWageHoldRecord(e));
    assert.equal(row.reason,transitiveWageHoldReason(e));
  }
  return new Set(expected);
}
export function reviewedTransitiveWageWithdrawals(before,after,read=readFileSync){
  const a=readTransitiveWageHoldArchive(read),held=verifyAllTransitiveWageHolds(after,read);
  for(const e of a.methods){
    const file=before.allApiRouteFiles[e.path],prior=file?.methods.find(x=>x.name===e.verb);
    assert.equal(file?.gitBlobSha,e.routeBlobSha,"Prior route SHA changed");
    assert.equal(prior?.status,"COVERED","Only base credits may be withdrawn");
    assert.deepEqual(prior.testedBy,e.priorProof,"Prior proof must match PR base");
  }
  return held;
}
export function historicTransitiveWageProofView(m,read=readFileSync){
  const holds=Object.values(m.allApiRouteFiles).flatMap(file=>file.methods)
    .filter(x=>x.reviewedUncertified?.kind===TRANSITIVE_HOLD_KIND).length;
  if(holds===0)return m;
  assert.equal(holds,47,"Partial transitive proof cannot be projected");
  const a=readTransitiveWageHoldArchive(read);
  verifyAllTransitiveWageHolds(m,read);
  const view=structuredClone(m);
  for(const e of a.methods){
    const row=view.allApiRouteFiles[e.path].methods.find(x=>x.name===e.verb);
    row.status="COVERED";row.testedBy=structuredClone(e.priorProof);
    delete row.reviewedUncertified;
    row.reason="HISTORICAL VIEW ONLY: previous source-bound receipt; currently HELD.";
  }
  view.metrics.gap-=47;view.metrics.coveredAfter+=47;
  view.acceptanceStatus=view.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/,
    "NOT ACCEPTED: "+view.metrics.gap+" API methods");
  return view;
}
