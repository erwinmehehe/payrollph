import assert from "node:assert/strict";
import test from "node:test";
import { completePayrollDraftBrowserKey, payrollDraftBrowserKey, payrollDraftIntentFingerprint, validPayrollDraftKey } from "../src/lib/payroll-draft-intent";

const intent = { organizationId: 7, legalEntityId: 8, scopeOrgUnitId: null,
  periodStart: "2026-10-01", periodEnd: "2026-10-15", payDate: "2026-10-15", processNow: true };
function storage() {
  const values = new Map<string,string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key,value); },removeItem:(key:string)=>{values.delete(key);} };
}
test("same intent survives retry, object reconstruction and simulated page reload", () => {
  const saved = storage(); let generated = 0;
  const generate = () => "fictional-intent-" + ++generated;
  const first = payrollDraftBrowserKey(saved, 9, intent, generate);
  assert.equal(payrollDraftBrowserKey(saved,9,{...intent},generate),first);
  assert.equal(payrollDraftBrowserKey({getItem:saved.getItem,setItem:saved.setItem},9,intent,generate),first);
  assert.equal(generated,1);
});
test("changed dates, processing mode, employer and caller do not reuse the old browser intent", () => {
  const saved = storage(); let generated = 0;
  const generate = () => "fictional-intent-" + ++generated;
  const first = payrollDraftBrowserKey(saved,9,intent,generate);
  for (const changed of [{...intent,payDate:"2026-10-16"},{...intent,processNow:false},
    {...intent,legalEntityId:10},{...intent,scopeOrgUnitId:2},{...intent,organizationId:11}]) {
    assert.notEqual(payrollDraftBrowserKey(saved,9,changed,generate),first);
    assert.notEqual(payrollDraftIntentFingerprint(changed),payrollDraftIntentFingerprint(intent));
  }
  assert.notEqual(payrollDraftBrowserKey(saved,12,intent,generate),first);
});
test("corrupt or unavailable storage fails before creating another uncertain write", () => {
  for (const saved of ["{",'{}','{"key":"bad","fingerprint":"x"}']) {
    assert.throws(()=>payrollDraftBrowserKey({getItem:()=>saved,setItem:()=>assert.fail()},9,intent),/Saved payroll attempt/);
  }
  assert.throws(()=>payrollDraftBrowserKey({getItem:()=>{throw Error("Storage disabled");},setItem:()=>assert.fail()},9,intent),/Storage disabled/);
  assert.throws(()=>payrollDraftBrowserKey({getItem:()=>null,setItem:()=>{throw Error("Storage full");}},9,intent,()=>"fictional-intent-1"),/Storage full/);
});
test("creation key rejects unsafe or unbounded headers", () => {
  for (const value of [null,1,"", "short", " ".repeat(16),"a".repeat(129),"fictional\nheader-injection"]) assert.equal(validPayrollDraftKey(value),false);
  assert.equal(validPayrollDraftKey("fictional-intent-1"),true);
});
test("verified success retires only that intent; late success cannot erase its replacement",()=>{
  const saved=storage();let generated=0;const generate=()=>"fictional-intent-"+ ++generated;
  const first=payrollDraftBrowserKey(saved,9,intent,generate);
  const next={...intent,payDate:"2026-10-16"};
  const second=payrollDraftBrowserKey(saved,9,next,generate);
  completePayrollDraftBrowserKey(saved,9,7,first);
  assert.equal(payrollDraftBrowserKey(saved,9,next,generate),second);
  completePayrollDraftBrowserKey(saved,9,7,second);
  assert.notEqual(payrollDraftBrowserKey(saved,9,next,generate),second);
});
