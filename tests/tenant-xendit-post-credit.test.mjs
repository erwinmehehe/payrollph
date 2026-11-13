import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {verifyXenditPostCredit,readXenditPostExecution,XENDIT_POST_PATH,XENDIT_POST_RECEIPT} from '../scripts/qa/tenant-xendit-post-credit.mjs';
const manifest=()=>JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json'));
const changedReader=(path,transform)=>(file,...args)=>file===path?transform(readFileSync(file,...args)):readFileSync(file,...args);
test('only the full executed four-operation PG16 receipt credits the exact Xendit POST',()=>{
 assert.equal(verifyXenditPostCredit(manifest()),1);
 const receipt=readXenditPostExecution();
 assert.equal(receipt.result.own.length,12);assert.equal(receipt.result.refusals.length,58);
 assert.equal(receipt.result.realProviderCalls,0);
 assert.equal(receipt.independentSecurityReview,'PENDING');
});
test('borrowed GET, altered job identity, missing modes and removed victim citations fail',()=>{
 for(const mutate of [r=>r.testedBy.file='scripts/qa/tenant-payroll-run-actions-http.mjs',
  r=>r.testedBy.workflowJobId++,r=>r.testedBy.methodActions.pop(),
  r=>delete r.testedBy.unchangedDbLine,r=>r.testedBy.independentlyAccepted=true,
  r=>r.status='GAP']){
  const m=manifest();mutate(m.allApiRouteFiles[XENDIT_POST_PATH].methods.find(x=>x.name==='POST'));
  assert.throws(()=>verifyXenditPostCredit(m));
 }
});
test('executed result seal refuses a fabricated success or a different source head',()=>{
 for(const mutate of [r=>r.sourceCommit='0'.repeat(40),r=>r.result.own.pop(),
  r=>r.result.refusals[0].unchangedProtectedSql=false,r=>r.result.realProviderCalls=1,
  r=>delete r.inputs['src/lib/auth.ts']]){
  assert.throws(()=>readXenditPostExecution(changedReader(XENDIT_POST_RECEIPT,raw=>{
   const r=JSON.parse(raw);mutate(r);return Buffer.from(JSON.stringify(r));
  })),/Executed Xendit receipt changed/);
 }
});
test('all executed runtime, authorization, seed, harness and transport bytes remain pinned',()=>{
 const r=readXenditPostExecution();
 assert.equal(Object.keys(r.inputs).length,70);
 for(const file of [XENDIT_POST_PATH,'src/lib/auth.ts','scripts/qa/tenant-xendit-post-proof-seed.mjs',
  'scripts/qa/tenant-xendit-post-proof-http.mjs','scripts/qa/tenant-xendit-post-proof-preload.mjs',
  'scripts/qa/tenant-xendit-post-provider-fixture.mjs','.github/workflows/tenant-xendit-post-proof.yml']){
  assert.ok(r.inputs[file]);
  assert.throws(()=>readXenditPostExecution(changedReader(file,raw=>Buffer.concat([Buffer.from(raw),Buffer.from('\n// changed executed input')]))),/Executed Xendit input drift/);
 }
});
