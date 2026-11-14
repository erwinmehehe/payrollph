import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {readOidcBatchExecution,verifyOidcBatchMethod,verifyOidcBatchCredits,historicOidcBatchView,
 OIDC_START,OIDC_BATCH_CALLBACK,OIDC_BATCH_RECEIPT} from '../scripts/qa/tenant-oidc-batch-credit.mjs';
import {verifyOidcCallbackHold} from '../scripts/qa/tenant-oidc-source-supersession.mjs';
const manifest=()=>JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json'));
const row=(m,path)=>m.allApiRouteFiles[path].methods.find(x=>x.name==='GET');
test('two current protocol steps require the exact successful HTTPS/PG16 run, with resolve held',()=>{
 const r=readOidcBatchExecution();assert.equal(r.workflowJobId,132322353286);
 assert.equal(verifyOidcBatchCredits(manifest()),2);
 assert.equal(Object.keys(r.inputs).length,214);
 assert.equal(r.proof.realProviderCalls,0);assert.equal(r.proof.coverageCredits,0);
});
test('either method refuses a borrowed citation, absent denial, status edit or changed original GAP history',()=>{
 for(const path of [OIDC_START,OIDC_BATCH_CALLBACK])for(const mutate of [
  r=>{r.testedBy=structuredClone(row(manifest(),path===OIDC_START?OIDC_BATCH_CALLBACK:OIDC_START).testedBy);},
  r=>{delete r.testedBy.foreignDenialLine;},r=>{delete r.testedBy.unchangedDbLine;},
  r=>{delete r.testedBy.forgedSelectorLine;},r=>{r.testedBy.independentlyAccepted=true;},
  r=>{r.status='GAP';},r=>{r.historicalOidcSourceWithdrawal.reason+=' forged';},
 ]){const m=manifest();mutate(row(m,path));assert.throws(()=>verifyOidcBatchMethod(m,path));}
 const m=manifest();m.allApiRouteFiles['src/app/api/auth/sso/resolve/route.ts'].methods[0].status='COVERED';
 assert.throws(()=>verifyOidcBatchCredits(m),/Owner explicitly held/);
});
test('changing any executed input, receipt or baseline SQL inventory requires a new real proof',()=>{
 const r=readOidcBatchExecution();
 for(const path of [OIDC_START,OIDC_BATCH_CALLBACK,...Object.keys(r.inputs).filter(p=>/schema|workflow|contract/.test(p)).slice(0,4),OIDC_BATCH_RECEIPT]){
  const read=(p,...args)=>{const value=readFileSync(p,...args);return p===path?Buffer.concat([Buffer.from(value),Buffer.from(' changed')]):value;};
  assert.throws(()=>readOidcBatchExecution(read));
 }
 assert.throws(()=>readOidcBatchExecution(readFileSync,p=>[...readdirSync(p),'9999_unexecuted.sql']),/SQL inventory changed/);
});
test('historical page/payroll view restores only the two sealed GAP rows, never the committed ledger',()=>{
 const m=manifest(),before=structuredClone(m),old=historicOidcBatchView(m);
 assert.deepEqual(m,before);assert.equal(old.metrics.gap,m.metrics.gap+2);
 assert.equal(old.metrics.coveredAfter,m.metrics.coveredAfter-2);
 assert.equal(verifyOidcCallbackHold(old),0);
 for(const[path,entry]of Object.entries(m.allApiRouteFiles))if(![OIDC_START,OIDC_BATCH_CALLBACK].includes(path))assert.deepEqual(old.allApiRouteFiles[path],entry);
 assert.deepEqual(old.scopedPages,m.scopedPages);
});
