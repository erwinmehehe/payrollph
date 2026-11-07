import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifyMigrationPostCredit } from "../scripts/qa/tenant-migrations-post-credit.mjs";
const original = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json","utf8"));
const post = m => m.allApiRouteFiles["src/app/api/migrations/route.ts"].methods.find(m=>m.name==="POST");
test("full four-kind existing PG16 source-matched migration method receipt",()=>assert.equal(verifyMigrationPostCredit(original),1));
test("no forged, partial, or null receipt may earn method credit",()=>{
  for(const modify of [
    m=>{post(m).testedBy.workflowRunId=1;},m=>{post(m).testedBy.ownPositiveLine=60;},
    m=>{post(m).testedBy.methodActions=["employees"];},m=>{post(m).testedBy=null;},
    m=>{post(m).testedBy.productionTested=true;},m=>{post(m).status="GAP";}
  ]) {const m=structuredClone(original);modify(m);assert.throws(()=>verifyMigrationPostCredit(m));}
});
test("runtime, runner or auth source drift requires renewed proof",()=>{
 for(const changed of ["src/app/api/migrations/route.ts","src/lib/access.ts","scripts/qa/tenant-requested-migrations-http.mjs","src/db/schema.ts"]) {
 const reader=p=>p===changed?Buffer.from("drift"):readFileSync(p);
 assert.throws(()=>verifyMigrationPostCredit(original,reader),/drift/);
 }
});
test("no credits borrowed by unrelated tenant GAP methods",()=>{
 for(const [p,v] of [["src/app/api/documents/route.ts","POST"],["src/app/api/approvals/[id]/route.ts","PATCH"],["src/app/api/multi-entity/transfers/route.ts","POST"]])
 assert.equal(original.allApiRouteFiles[p].methods.find(m=>m.name===v).status,"GAP");
});
