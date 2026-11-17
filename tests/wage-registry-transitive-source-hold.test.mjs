import {readWageWithdrawalFixture} from './helpers/wage-renewal-fixture.mjs';
import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {
  TRANSITIVE_HOLD_ARCHIVE,TRANSITIVE_HOLD_KIND,
  readTransitiveWageHoldArchive,verifyAllTransitiveWageHolds,
  reviewedTransitiveWageWithdrawals
} from "../scripts/qa/wage-registry-transitive-source-hold.mjs";
import {historicWageRegistryProofView} from "../scripts/qa/wage-registry-source-hold.mjs";
import {verifySsoResolveClassification} from '../scripts/qa/tenant-sso-resolve-public-classification.mjs';
const read=()=>readWageWithdrawalFixture();
test("47 transitive source-dependent credits are withdrawn, source-sealed and unaccepted",()=>{
  const m=read(),a=readTransitiveWageHoldArchive();
  assert.equal(a.methods.length,47);
  assert.equal(verifyAllTransitiveWageHolds(m).size,47);
  const publicResolve=m.allApiRouteFiles['src/app/api/auth/sso/resolve/route.ts'].methods[0].status==='PUBLIC-BY-DESIGN'?verifySsoResolveClassification(m):0;
  assert.equal(publicResolve, 1, "The current SSO public classification requires its exact owner and source proof");
  const rows=Object.values(m.allApiRouteFiles).flatMap(file=>file.methods);
  assert.deepEqual([m.metrics.coveredAfter,m.metrics.gap,m.metrics.publicByDesign],
    ["COVERED","GAP","PUBLIC-BY-DESIGN"].map(status=>rows.filter(row=>row.status===status).length),
    "Live totals must derive from actual classifications rather than frozen source-proof counts");
  const historic=historicWageRegistryProofView(m);
  assert.equal(historic.metrics.coveredAfter,m.metrics.coveredAfter+75);
  assert.equal(historic.metrics.gap,m.metrics.gap-75);
  for(const e of a.methods){
    const current=m.allApiRouteFiles[e.path].methods.find(x=>x.name===e.verb);
    const prior=historic.allApiRouteFiles[e.path].methods.find(x=>x.name===e.verb);
    assert.equal(current.status,"GAP");
    assert.equal(current.testedBy,null);
    assert.equal(current.reviewedUncertified.kind,TRANSITIVE_HOLD_KIND);
    assert.equal(current.reviewedUncertified.execution,"NOT_RUN");
    assert.equal(current.reviewedUncertified.coverageCredits,0);
    assert.equal(current.reviewedUncertified.productionCertified,false);
    assert.equal(prior.status,"COVERED");
    assert.deepEqual(prior.testedBy,e.priorProof);
  }
  assert.equal(reviewedTransitiveWageWithdrawals(historic,m).size,47);
  assert.equal(reviewedTransitiveWageWithdrawals(m,m).size,0);
  assert.equal(reviewedTransitiveWageWithdrawals(historic,historic).size,0);
});
test("missing hold, invented new credit, modified archive and changed wage code fail closed",()=>{
  const m=read(),a=readTransitiveWageHoldArchive(),e=a.methods[0];
  const row=()=>m.allApiRouteFiles[e.path].methods.find(x=>x.name===e.verb);
  row().status="COVERED";
  assert.throws(()=>verifyAllTransitiveWageHolds(m));
  row().status="GAP";
  row().testedBy=e.priorProof;
  assert.throws(()=>verifyAllTransitiveWageHolds(m));
  row().testedBy=null;
  row().reviewedUncertified.coverageCredits=1;
  assert.throws(()=>verifyAllTransitiveWageHolds(m));
  const mutated=path=>path===TRANSITIVE_HOLD_ARCHIVE
    ?Buffer.concat([readFileSync(path),Buffer.from("\n")]):readFileSync(path);
  assert.throws(()=>readTransitiveWageHoldArchive(mutated),/archive modified/);
  const wageChange=path=>path.endsWith("/wage-orders.ts")
    ?Buffer.concat([readFileSync(path),Buffer.from("\n// changed")]):readFileSync(path);
  assert.throws(()=>verifyAllTransitiveWageHolds(read(),wageChange),/Unreviewed wage source/);
});
