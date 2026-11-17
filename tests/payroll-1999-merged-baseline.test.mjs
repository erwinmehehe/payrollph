/** Post-merge regression for verification-only historical source projections. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {wageRenewalHoldView,WAGE_RENEWAL_KIND} from '../scripts/qa/wage-registry-renewal-verify.mjs';
import {reviewedWageRegistrySourceWithdrawals} from '../scripts/qa/wage-registry-source-hold.mjs';
import {assertLiveTenantCounts} from './helpers/tenant-counts.mjs';
test('renewed main is a valid comparison base for historical wage catalogue checks without withdrawing credits',async()=>{
 const path='scripts/qa/tenant-isolation-coverage-manifest.json',raw=readFileSync(path),live=JSON.parse(raw),historical=wageRenewalHoldView(live);
 const renewals=Object.values(live.allApiRouteFiles).flatMap(file=>file.methods).filter(row=>row.testedBy?.kind===WAGE_RENEWAL_KIND).length;
 if(renewals===0){
  const {verifyWageRenewalEngineWithdrawal}=await import('../scripts/qa/wage-registry-renewal-supersession.mjs');
  assert.equal(verifyWageRenewalEngineWithdrawal(live).size,75,'Zero renewals require the full exact-engine withdrawal, never an arbitrary downgrade');
 }else assert.equal(renewals,75);
 assert.equal(reviewedWageRegistrySourceWithdrawals(live,historical).size,renewals);
 assert.equal(reviewedWageRegistrySourceWithdrawals(live,live).size,0);
 assert.doesNotThrow(()=>assertLiveTenantCounts(assert,historical,{}, {ref:'verified historical projection',manifest:wageRenewalHoldView(live)}));
 assert.doesNotThrow(()=>assertLiveTenantCounts(assert,live,{}, {ref:'verified renewed main',manifest:live}));
 assert.deepEqual(readFileSync(path),raw);
 const forged=structuredClone(live);
 const row=forged.allApiRouteFiles['src/app/api/compliance/validate/route.ts'].methods.find(m=>m.name==='POST');
 row.testedBy={...(row.testedBy??{}),kind:WAGE_RENEWAL_KIND,renewalReceiptBlobSha:'0'.repeat(40)};
 assert.throws(()=>reviewedWageRegistrySourceWithdrawals(forged,historical));
 assert.throws(()=>wageRenewalHoldView(forged));
 const partial=structuredClone(historical);
 partial.allApiRouteFiles['src/app/api/compliance/validate/route.ts'].methods.find(m=>m.name==='POST').status='COVERED';
 assert.throws(()=>reviewedWageRegistrySourceWithdrawals(live,partial));
 const edited=structuredClone(historical);
 edited.allApiRouteFiles['src/app/api/compliance/validate/route.ts'].methods.find(m=>m.name==='POST').reason+=' forged';
 assert.throws(()=>reviewedWageRegistrySourceWithdrawals(live,edited));
});
