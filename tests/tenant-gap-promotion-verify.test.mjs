import {readWageWithdrawalFixture} from './helpers/wage-renewal-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyPromotionCredits} from '../scripts/qa/tenant-gap-promotion-verify.mjs';
import {historicWageRegistryProofView,verifyAllWageRegistrySourceHolds} from '../scripts/qa/wage-registry-source-hold.mjs';
import {verifyAllTransitiveWageHolds} from '../scripts/qa/wage-registry-transitive-source-hold.mjs';
const live=readWageWithdrawalFixture();
assert.equal(verifyAllWageRegistrySourceHolds(live).length,23);
assert.equal(verifyAllTransitiveWageHolds(live).size,47);
const original=historicWageRegistryProofView(live);
assert.equal(live.allApiRouteFiles['src/app/api/auth/me/route.ts'].methods[0].status,'GAP');
assert.equal(live.allApiRouteFiles['src/app/api/auth/me/route.ts'].methods[0].testedBy,null);
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
