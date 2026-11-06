import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {verifyRootCredits} from "../scripts/qa/tenant-root-planning-credit.mjs";
const read=()=>JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json"));
test("both root methods require their exact executed source receipt",()=>{
  assert.equal(verifyRootCredits(read()),2);
  const m=read();m.allApiRouteFiles["src/app/api/workforce-planning/route.ts"].methods.find(x=>x.name==="POST").testedBy.workflowJobId=1;
  assert.throws(()=>verifyRootCredits(m));
  for(const target of ["scripts/qa/tenant-root-planning-credit-receipt.json","scripts/qa/tenant-table-rows/write/workforce-planning-root.mjs","src/app/api/workforce-planning/route.ts"]){
    const reader=path=>path===target?Buffer.concat([readFileSync(path),Buffer.from("\nchanged")]):readFileSync(path);
    assert.throws(()=>verifyRootCredits(read(),reader),/identity changed|input drift/);
  }
});
