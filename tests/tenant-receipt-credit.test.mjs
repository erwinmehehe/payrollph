import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {receiptProofs,verifyReceiptCredits} from "../scripts/qa/tenant-receipt-credit.mjs";

const manifest=()=>JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json","utf8"));
const route="src/app/api/expenses/receipts/route.ts";
const receipt="scripts/qa/tenant-receipt-credit-receipt.json";
test("receipt credits require both exact merged methods and their executed evidence",()=>{
  assert.equal(verifyReceiptCredits(manifest()),2);
  const proofs=receiptProofs();
  assert.notEqual(proofs.GET.ownPositiveLine,proofs.POST.ownPositiveLine);
  assert.equal(proofs.GET.workflowJobId,127727146937);
  assert.equal(proofs.POST.productionTested,false);
});
test("source drift, forged receipt and removed discrimination invalidate promotion",()=>{
  for(const path of [route,receipt,"scripts/qa/tenant-receipt-boundary-http.mjs","src/lib/spend-receipt-storage.ts"]){
    const reader=file=>file===path?Buffer.concat([readFileSync(file),Buffer.from("\n// changed\n")]):readFileSync(file);
    assert.throws(()=>receiptProofs(reader),/receipt identity changed|receipt input drift/);
  }
});
test("missing method, missing credit, borrowed positive or certification claim is rejected",()=>{
  for(const mutate of [
    m=>m.allApiRouteFiles[route].methods.pop(),
    m=>{m.allApiRouteFiles[route].methods[0].status="GAP";},
    m=>{m.allApiRouteFiles[route].methods[0].testedBy.ownPositiveLine=1;},
    m=>{m.allApiRouteFiles[route].methods[0].testedBy.productionTested=true;},
    m=>{m.allApiRouteFiles[route].methods[0].testedBy.workflowRunId=1;},
  ]){const m=manifest();mutate(m);assert.throws(()=>verifyReceiptCredits(m));}
});
