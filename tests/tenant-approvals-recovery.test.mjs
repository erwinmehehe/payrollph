import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {INPUTS,OUTPUT,recoveryWorkflow} from '../scripts/qa/tenant-approvals-recovery-workflow.mjs';
const yaml=createRequire(import.meta.url)('js-yaml');
test('all five existing proof families and both payroll profiles run on the exact head',()=>{
 const workflow=recoveryWorkflow();
 assert.deepEqual(yaml.load(readFileSync(OUTPUT,'utf8')),workflow);
 const jobs=Object.entries(workflow.jobs).filter(([id])=>id!=='complete-method-receipt').map(([,job])=>job);
 assert.equal(jobs.length,INPUTS.length);
 assert.equal(workflow.jobs['complete-method-receipt'].needs.length,INPUTS.length);
 assert.deepEqual(workflow.jobs['money-lifecycle-pg16'].strategy.matrix['exact-links'],['false','true']);
 for(const job of jobs){assert.equal(job.services.postgres.image,'postgres:16');
  assert.equal(job.steps.find(s=>s.uses?.startsWith('actions/checkout@')).with.ref,'${{ github.event.pull_request.head.sha || github.sha }}');
  for(const k of ['FINAL_PAY_SIGNED_REVIEW_ENABLED','EXACT_THIRTEENTH_CENTAVOS_ENABLED','PAYROLL_CALCULATION_HISTORY_ENABLED','NEXT_CSP_ENABLED'])assert.equal(job.env[k],'false');
 }
});
test('missing proof family is refused, not treated as completed coverage',()=>{
 assert.throws(()=>recoveryWorkflow((p,e)=>p.endsWith(INPUTS[0])?'jobs: {}':readFileSync(p,e)));
});
