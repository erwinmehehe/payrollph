/**
 * An old page-only proof may replay the original private-document GET credit
 * in memory, while the live changed handler remains a zero-credit GAP.
 * NO new method credit, production or independent security approval.
 */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {historicalDocumentGetView} from "../scripts/qa/tenant-oidc-batch-credit-verify.mjs";
const PATH = "src/app/api/documents/[id]/route.ts";
const live = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json","utf8"));
const method = m => m.allApiRouteFiles[PATH].methods[0];
test("historical projection changes only an exact old-document receipt, not active GAP ledger",()=>{
  assert.equal(method(live).status,"GAP");
  assert.equal(method(live).testedBy,null);
  const before=structuredClone(live);
  const view=historicalDocumentGetView(live);
  assert.notStrictEqual(view,live);
  assert.equal(method(view).status,"COVERED");
  assert.deepEqual(method(view).testedBy,method(live).reviewedUncertified.previousMethodProof);
  assert.equal(method(view).reviewedUncertified,undefined);
  assert.equal(view.allApiRouteFiles[PATH].gitBlobSha,
    method(live).reviewedUncertified.previousRouteBlobSha);
  assert.equal(view.metrics.coveredAfter,live.metrics.coveredAfter+1);
  assert.equal(view.metrics.gap,live.metrics.gap-1);
  assert.deepEqual(live,before,"Historical accounting must never mutate the active source ledger");
  const after=Object.values(view.allApiRouteFiles).flatMap(f=>f.methods);
  assert.equal(view.metrics.gap,after.filter(m=>m.status==="GAP").length);
  assert.equal(view.metrics.coveredAfter,after.filter(m=>m.status==="COVERED").length);
});
test("historical projection rejects tampered status, proof, guard, receipt and claimed approval",()=>{
  const tamper=[
    x=>{method(x).status="COVERED";},
    x=>{method(x).testedBy={file:"fabricated"};},
    x=>{method(x).reviewedUncertified.previousMethodProof={file:"fabricated"};},
    x=>{method(x).reviewedUncertified.coverageCredits=1;},
    x=>{method(x).reviewedUncertified.exactHeadPg16Http="PASS";},
    x=>{method(x).reviewedUncertified.productionCertified=true;},
    x=>{method(x).reviewedUncertified.independentSecurityReview="APPROVED";},
    x=>{x.allApiRouteFiles[PATH].gitBlobSha="f".repeat(40);},
    x=>{x.allApiRouteFiles[PATH].sourceRevisionReview.noNewMethodCredit=false;},
    x=>{x.metrics.gap=0;},
    x=>{x.metrics.coveredAfter=461;},
  ];
  for(const mutate of tamper){
    const modified=structuredClone(live);
    mutate(modified);
    assert.throws(()=>historicalDocumentGetView(modified),
      undefined,"Forged prior GET credit or live GAP must not be replayed");
  }
  const fakeReader = file => file===PATH
    ? Buffer.from(readFileSync(file,"utf8").replace("assertEntityResource(", "skipEntityResource("))
    : readFileSync(file);
  assert.throws(()=>historicalDocumentGetView(live,fakeReader),
    /changed live authorization guard/);
  const fakeContract = file => file==="tests/tenant-private-document-id-boundary.test.mjs"
    ? Buffer.concat([readFileSync(file),Buffer.from("\n")])
    : readFileSync(file);
  assert.throws(()=>historicalDocumentGetView(live,fakeContract),
    /original source contract changed/);
});
test("historic validator does not invent a private-document hold on ordinary main",()=>{
 const historical = structuredClone(live);
 const row=historical.allApiRouteFiles[PATH];
 row.gitBlobSha="0acb38b1396b1e35adf02efd6e033cdd0416e0d0";
 row.methods[0].status="COVERED";
 row.methods[0].testedBy=structuredClone(row.methods[0].reviewedUncertified.previousMethodProof);
 delete row.methods[0].reviewedUncertified;
 row.sourceRevisionReview=structuredClone(row.sourceRevisionReview.priorActiveMembershipRevision);
 historical.metrics.coveredAfter++;
 historical.metrics.gap--;
 assert.strictEqual(historicalDocumentGetView(historical),historical,
    "Already proved historical main must be a no-op");
});
