import {verifySecurityCredits} from '../scripts/qa/tenant-security-write-credit.mjs';
import assert from "node:assert/strict";
import {verifyApprovalsCredit} from '../scripts/qa/tenant-approvals-credit.mjs';
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifyCareersPatchCredit, CAREERS_CREDIT_RECEIPT } from "../scripts/qa/tenant-careers-patch-credit.mjs";
import { assertLiveTenantCounts } from "./helpers/tenant-counts.mjs";
const manifest=JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json","utf8"));
const target=m=>m.allApiRouteFiles["src/app/api/careers/admin/route.ts"].methods.find(x=>x.name==="PATCH");
test("source-matched real-HTTP PG16 careers PATCH earns exactly one provisional method credit",()=>{
  assert.equal(verifyCareersPatchCredit(manifest),1);
  assert.deepEqual(target(manifest).testedBy.postActions,["publish","unpublish"]);
  assert.equal(CAREERS_CREDIT_RECEIPT.workflowRunId,41798531116);
  assert.equal(CAREERS_CREDIT_RECEIPT.workflowJobId,126468332784);
  assertLiveTenantCounts(assert, manifest);
});
test("no forged, partial or production-accepted careers evidence can be promoted",()=>{
  for(const mutate of [
    m=>{target(m).status="GAP";}, m=>{target(m).testedBy=null;},
    m=>{target(m).testedBy.ownPositiveLine=220;},
    m=>{target(m).testedBy.workflowRunId=1;},
    m=>{target(m).testedBy.postActions=["publish"];},
    m=>{target(m).testedBy.productionTested=true;},
    m=>{target(m).reviewedUncertified={claimed:true};},
  ]){const copy=structuredClone(manifest);mutate(copy);assert.throws(()=>verifyCareersPatchCredit(copy));}
});
test("tampering with exercised tenant route, runner, auth, SQL fixture or workflow cancels credit",()=>{
  for(const tampered of ["src/app/api/careers/admin/route.ts",
    "scripts/qa/tenant-edg01-careers-publication-http.mjs",
    "src/lib/access.ts","src/db/schema.ts",
    "docs/engineering/migration-proposals/careers-published.sql",
    ".github/workflows/tenant-edg01-careers-publication-http.yml"]){
    assert.throws(()=>verifyCareersPatchCredit(manifest,file=>
      file===tampered?Buffer.from("changed proof input"):readFileSync(file)),/drift/);
  }
});
test("neighboring unproved careers mutations do not receive an implicit credit",()=>{
  // bir/annual-employer/candidate POST was credited later by its own dedicated proof (#1891) and is guarded there.
  for(const [p,v] of [["src/app/api/documents/route.ts","POST"],
    ["src/app/api/approvals/[id]/route.ts","PATCH"]])
      if(p==='src/app/api/documents/route.ts')assert.equal(verifySecurityCredits(manifest),3);
      else assert.equal(verifyApprovalsCredit(manifest),1);
});
