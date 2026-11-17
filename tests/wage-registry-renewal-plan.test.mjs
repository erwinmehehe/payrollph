import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {renewalWorkflow,generatedWorkflow,OUTPUT} from '../scripts/qa/wage-registry-renewal-workflow.mjs';
import {readWageRenewalInventory,INVENTORY,captureWageRenewalInventory} from '../scripts/qa/wage-registry-renewal-plan.mjs';

test('the renewal starts from exactly 75 immutable current-main withdrawals, not earlier credit guesses',()=>{
 const inv=readWageRenewalInventory();
 assert.equal(inv.baseMainCommit,'5646f6c99c9ef025e40ad0a9a070aa4b596a3a4f');
 const counts={};for(const e of inv.methods)counts[e.held.reviewedUncertified.kind]=(counts[e.held.reviewedUncertified.kind]||0)+1;
 assert.deepEqual(Object.values(counts).sort((a,b)=>a-b),[5,23,47]);
 assert.throws(()=>captureWageRenewalInventory(),/Never overwrite/);
 assert.throws(()=>readWageRenewalInventory(p=>p===INVENTORY?Buffer.concat([readFileSync(p),Buffer.from('\n')]):readFileSync(p)),/immutable/);
});

test('the dedicated renewal preserves original recipes and requires the exact proposed checkout',()=>{
 assert.equal(readFileSync(OUTPUT,'utf8'),generatedWorkflow());
 const workflow=renewalWorkflow();assert.ok(Object.keys(workflow.jobs).length>=30);
 assert.equal(workflow.permissions.contents,'read');assert.equal(workflow.permissions.actions,'read');
 for(const job of Object.values(workflow.jobs)){
  if(!job.steps.some(x=>x.uses?.startsWith('actions/checkout@')))continue;
  const step=job.steps.find(x=>x.name==='Verify exact proposed renewal source');assert.ok(step);
  assert.equal(step.env.WAGE_RENEWAL_EXPECTED_HEAD,'${{ github.event.pull_request.head.sha }}');
 }
 const changed=renewalWorkflow((file,...rest)=>file.endsWith('tenant-spend-write-actions-http.yml')
  ?readFileSync(file,...rest).toString().replace('node --import tsx scripts/qa/tenant-spend-write-actions-http.mjs','echo must-not-replace-proof'):readFileSync(file,...rest));
 // Canonical generation detects any original recipe drift rather than borrowing
 // old execution or relaxing its runtime assertions.
 assert.notDeepEqual(changed.jobs['spend__spend-full-write-method'],workflow.jobs['spend__spend-full-write-method']);
});
