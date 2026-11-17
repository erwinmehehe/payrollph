import {readWageWithdrawalFixture} from './helpers/wage-renewal-fixture.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {verifySpendManaged,TARGETS} from "../scripts/qa/tenant-spend-managed-credit.mjs";
import {verifyAllSealedWageHolds, SEALED_WAGE_HOLD_KIND} from "../scripts/qa/wage-registry-sealed-receipt-source-hold.mjs";

const manifest=()=>readWageWithdrawalFixture();
const spendRow=(m,key)=>{
  const at=key.indexOf(" "),verb=key.slice(0,at),route=key.slice(at+1);
  return m.allApiRouteFiles["src/app/api/"+route+"/route.ts"].methods.find(x=>x.name===verb);
};

test("all three Spend/managed receipts remain archived; current wage source credits zero",()=>{
  const m=manifest();
  const seals=verifyAllSealedWageHolds(m);
  assert.equal(seals.size,5,"Five exact original full-source receipts must be withdrawn");
  for(const key of TARGETS){
    const method=spendRow(m,key);
    assert.equal(method.status,"GAP",key+": old source seal cannot remain current");
    assert.equal(method.testedBy,null);
    assert.equal(method.reviewedUncertified?.kind,SEALED_WAGE_HOLD_KIND);
    assert.equal(method.reviewedUncertified.coverageCredits,0);
    assert.ok(method.reviewedUncertified.priorProof);
    assert.ok(seals.has(key.slice(0,key.indexOf(" "))+" src/app/api/"+key.slice(key.indexOf(" ")+1)+"/route.ts"));
  }
  assert.throws(()=>verifySpendManaged(m),"Historical full-input source hash must reject the changed wage registry");
});

test("tampered sealed wage source, statutory watch, archive or receipt fails closed",()=>{
  const m=manifest();
  for(const target of [
    "src/lib/wage-orders.ts","src/lib/statutory-rule-watch.ts",
    "scripts/qa/wage-registry-sealed-receipt-source-hold-archive.json",
    "scripts/qa/tenant-spend-managed-receipt.json",
    "scripts/qa/tenant-enterprise-admin-credit-receipt.json",
    "scripts/qa/tenant-studio-post-credit-receipt.json",
  ]){
    assert.throws(()=>verifyAllSealedWageHolds(m,p=>{
      const bytes=readFileSync(p);
      return p===target?Buffer.concat([bytes,Buffer.from("unreviewed")]):bytes;
    }),"No old receipt or changed current source may be substituted: "+target);
  }
});

test("falsified source-held Spend method status or old proof cannot earn coverage",()=>{
  const m=manifest();
  for(const key of TARGETS){
    for(const mutate of [
      method=>{method.status="COVERED";},
      method=>{method.testedBy=structuredClone(method.reviewedUncertified.priorProof);},
      method=>{method.reviewedUncertified.coverageCredits=1;},
      method=>{method.reviewedUncertified.priorProof={file:"borrowed.mjs"};},
    ]){
      const forged=structuredClone(m);mutate(spendRow(forged,key));
      assert.throws(()=>verifyAllSealedWageHolds(forged),"A forged current method cannot borrow old full-input evidence");
    }
  }
});
