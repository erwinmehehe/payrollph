/** Post-merge regression for verification-only historical source projections. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {wageRenewalHoldView} from '../scripts/qa/wage-registry-renewal-verify.mjs';
import {reviewedWageRegistrySourceWithdrawals} from '../scripts/qa/wage-registry-source-hold.mjs';
import {assertLiveTenantCounts} from './helpers/tenant-counts.mjs';
test('renewed main is a valid comparison base for historical wage catalogue checks without withdrawing credits',()=>{
 const path='scripts/qa/tenant-isolation-coverage-manifest.json',raw=readFileSync(path),live=JSON.parse(raw),historical=wageRenewalHoldView(live);
 assert.equal(reviewedWageRegistrySourceWithdrawals(live,historical).size,75);
 assert.equal(reviewedWageRegistrySourceWithdrawals(live,live).size,0);
 assert.doesNotThrow(()=>assertLiveTenantCounts(assert,historical,{}, {ref:'verified historical projection',manifest:wageRenewalHoldView(live)}));
 assert.doesNotThrow(()=>assertLiveTenantCounts(assert,live,{}, {ref:'verified renewed main',manifest:live}));
 assert.deepEqual(readFileSync(path),raw);
 const forged=structuredClone(live);
 const row=forged.allApiRouteFiles['src/app/api/compliance/validate/route.ts'].methods.find(m=>m.name==='POST');
 row.testedBy.renewalReceiptBlobSha='0'.repeat(40);
 assert.throws(()=>reviewedWageRegistrySourceWithdrawals(forged,historical));
 assert.throws(()=>wageRenewalHoldView(forged));
 const partial=structuredClone(historical);
 partial.allApiRouteFiles['src/app/api/compliance/validate/route.ts'].methods.find(m=>m.name==='POST').status='COVERED';
 assert.throws(()=>reviewedWageRegistrySourceWithdrawals(live,partial));
 const edited=structuredClone(historical);
 edited.allApiRouteFiles['src/app/api/compliance/validate/route.ts'].methods.find(m=>m.name==='POST').reason+=' forged';
 assert.throws(()=>reviewedWageRegistrySourceWithdrawals(live,edited));
});
