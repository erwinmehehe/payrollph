import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyFreshSamlExecution,FRESH_SAML_RECEIPT} from '../scripts/qa/tenant-saml-metadata-fresh-execution-verify.mjs';
test('inspected successful PG16 artifact is source-current and still awards zero credits',()=>{
 const r=verifyFreshSamlExecution();assert.equal(r.result.coverageCredits,0);
 assert.equal(r.result.currentStatus,'GAP');assert.equal(r.result.resolveHeld,true);
});
test('changed or invented execution, missing mode, provider disclosure or false acceptance invalidates evidence',()=>{
 const original=JSON.parse(readFileSync(FRESH_SAML_RECEIPT));
 for(const mutate of [r=>{r.runId='1';},r=>{r.sourceHead='0'.repeat(40);},
  r=>{r.result.disabledAndMissingIdentical404=false;},r=>{r.result.unchangedDbDuringHttp=false;},
  r=>{r.result.enabledThenDisabledConcealed=false;},r=>{r.result.coverageCredits=1;},
  r=>{r.result.independentlyAccepted=true;},r=>{delete r.inputs.sqlInventory;},
  r=>{r.result.resolveHeld=false;}]){
  const r=structuredClone(original);mutate(r);
  assert.throws(()=>verifyFreshSamlExecution((p,...args)=>p===FRESH_SAML_RECEIPT?Buffer.from(JSON.stringify(r)):readFileSync(p,...args)));
 }
});
test('every executed source/baseline input is immutable until a new real execution',()=>{
 const r=verifyFreshSamlExecution();
 for(const path of Object.keys(r.inputs.pins))assert.throws(()=>verifyFreshSamlExecution((p,...args)=>{
  const value=readFileSync(p,...args);return p===path?Buffer.concat([Buffer.from(value),Buffer.from(' changed')]):value;
 }),/executed input drift/);
});
