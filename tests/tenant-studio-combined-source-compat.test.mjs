import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {COMBINED_AUTOMATION_SHA,COMBINED_PROOF_PINS,combinedBlob,verifyCombinedStudioSource} from '../scripts/qa/tenant-studio-combined-source-compat.mjs';
import {restoreRecoveryPatch,restoreSessionPatch} from '../scripts/qa/tenant-automation-reviewed-patches.mjs';
test('both fixes compose to the exact historical engine without claiming new execution',()=>{
 const s=readFileSync('src/lib/automation.ts','utf8');
 assert.equal(combinedBlob(s),COMBINED_AUTOMATION_SHA);
 assert.equal(combinedBlob(restoreRecoveryPatch(s)),'b6e8900f11f39f12263acb7ecd140a823e89a623');
 assert.equal(combinedBlob(restoreSessionPatch(s)),'ce2c8e8feee4554c85f7739b73f2fa0325b81306');
 assert.equal(combinedBlob(restoreRecoveryPatch(restoreSessionPatch(s))),'288d27789e062803d68ea38fd41fa78ee155a1ee');
 assert.deepEqual(verifyCombinedStudioSource(),{credits:0,independentlyAccepted:false,productionCertified:false,sourceSha:COMBINED_AUTOMATION_SHA,proofStatus:'COMBINED_HEAD_HTTP_RENEWAL_REQUIRED'});
});
test('a single fix, unrelated engine edit or changed proof input cannot borrow composed evidence',()=>{
 const s=readFileSync('src/lib/automation.ts','utf8');
 for(const altered of [restoreRecoveryPatch(s),restoreSessionPatch(s),s+' changed'])
  assert.throws(()=>verifyCombinedStudioSource(p=>p==='src/lib/automation.ts'?Buffer.from(altered):readFileSync(p)));
 for(const target of Object.keys(COMBINED_PROOF_PINS))
  assert.throws(()=>verifyCombinedStudioSource(p=>p===target?Buffer.concat([readFileSync(p),Buffer.from(' changed')]):readFileSync(p)),undefined,target);
});
