import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyPromotionCredits} from '../scripts/qa/tenant-gap-promotion-verify.mjs';
const original=JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json','utf8'));
const pick=m=>m.allApiRouteFiles['src/app/api/account/route.ts'].methods[0];
test('promotion catalogue requires all sixteen exact source-bound identities',()=>{
 assert.equal(verifyPromotionCredits(original),16);
 for(const mutate of [m=>pick(m).status='GAP',m=>pick(m).testedBy.file='scripts/qa/tenant-second-pass-http.mjs',
  m=>pick(m).testedBy.ownPositiveLine++,m=>pick(m).testedBy.workflowRunId++,
  m=>pick(m).testedBy.verifiedMainCommit='wrong',m=>delete pick(m).testedBy.unchangedDbLine]){
  const changed=structuredClone(original);mutate(changed);
  assert.throws(()=>verifyPromotionCredits(changed));
 }
});
test('source mutation cannot silently retain historical promotion evidence',()=>{
 assert.throws(()=>verifyPromotionCredits(original,file=>readFileSync(file,'utf8')+'\n// changed proof'),/source drift/);
 const changed=structuredClone(original);
 const other=changed.allApiRouteFiles['src/app/api/web-bundy/consent/route.ts'].methods.find(m=>m.name==='POST');
 other.status='COVERED';other.testedBy=structuredClone(pick(original).testedBy);
 assert.throws(()=>verifyPromotionCredits(changed),/unsupported promotion identity/);
});
