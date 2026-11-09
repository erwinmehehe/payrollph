import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertLiveTenantCounts } from "./helpers/tenant-counts.mjs";
import { verifyInvitationAcceptCredits, RECEIPTS, ROUTE } from "../scripts/qa/tenant-invitation-accept-credit.mjs";
const load=()=>JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json","utf8"));
const method=(m,verb)=>m.allApiRouteFiles[ROUTE].methods.find(x=>x.name===verb);
test("two source-current distinct PG16 invitation acceptance methods gain provisional receipts",()=>{
 const m=load();assert.equal(verifyInvitationAcceptCredits(m),2);
 assertLiveTenantCounts(assert, m);
 assert.notEqual(RECEIPTS.GET.workflowJobId,RECEIPTS.POST.workflowJobId);
});
test("faked jobs, missing methods, source drift, premature security acceptance fail closed",()=>{
 for(const change of [
  m=>method(m,"GET").status="GAP",
  m=>method(m,"POST").testedBy.workflowRunId++,
  m=>method(m,"GET").testedBy.evidence+="fake",
  m=>method(m,"POST").testedBy.ownPositiveLine=1,
  m=>method(m,"GET").testedBy.foreignDenialLine=2,
  m=>method(m,"POST").reviewedUncertified={coverageCredits:0},
  m=>method(m,"POST").testedBy.independentSecurityReview="APPROVED",
  m=>method(m,"GET").testedBy.productionTested=true,
  m=>m.allApiRouteFiles[ROUTE].gitBlobSha="0".repeat(40),
  m=>m.metrics.coveredAfter++,
  m=>m.acceptanceStatus="CERTIFIED"
 ]){const m=load();change(m);assert.throws(()=>verifyInvitationAcceptCredits(m));}
});
