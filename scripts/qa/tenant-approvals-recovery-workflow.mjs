import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url),yaml=require('js-yaml');
export const INPUTS=['tenant-approval-task-http.yml','tenant-approval-sources-http.yml','tenant-approval-flows-http.yml','tenant-approval-types-http.yml','tenant-money-lifecycle.yml'];
export const OUTPUT='.github/workflows/tenant-approvals-recovery.yml';
export function recoveryWorkflow(read=readFileSync){
 const jobs={};
 for(const file of INPUTS){
  const source=yaml.load(read('.github/workflows/'+file,'utf8'));
  for(const [id,job]of Object.entries(source.jobs)){
   assert.ok(!jobs[id],'Duplicate proof job');
   const checkout=job.steps.find(s=>s.uses?.startsWith('actions/checkout@'));
   assert.ok(checkout,'Exact-head checkout required');
   checkout.with={...checkout.with,ref:'${{ github.event.pull_request.head.sha || github.sha }}','persist-credentials':false};
   job.env={...job.env,FINAL_PAY_SIGNED_REVIEW_ENABLED:'false',EXACT_THIRTEENTH_CENTAVOS_ENABLED:'false',PAYROLL_CALCULATION_HISTORY_ENABLED:'false',NEXT_CSP_ENABLED:'false'};
   jobs[id]=job;
  }
 }
 assert.equal(Object.keys(jobs).length,5);
 const proofIds=Object.keys(jobs);
 jobs['complete-method-receipt']={needs:proofIds,if:'${{ always() }}','runs-on':'ubuntu-latest',steps:[{name:'Refuse partial approval-method evidence',env:{PROOF_RESULTS:'${{ toJSON(needs) }}',SOURCE_HEAD:'${{ github.event.pull_request.head.sha || github.sha }}'},run:'node -e "const results=JSON.parse(process.env.PROOF_RESULTS); if(Object.keys(results).length!==5 || Object.values(results).some(x=>x.result!==\'success\')) process.exit(1); console.log(JSON.stringify({label:\'SOLO_VERIFIED_DEV_RECOVERY\',sourceHead:process.env.SOURCE_HEAD,proofResults:results,promotableMethods:1,creditedMethods:0,productionAccepted:false}))"'}]};
 return {name:'Approvals PATCH recovery — complete PG16 proof gate',on:{pull_request:{types:['opened','synchronize','reopened','ready_for_review'],branches:['main'],paths:[OUTPUT,'scripts/qa/tenant-approval*.mjs','scripts/qa/tenant-money-lifecycle-http.mjs','tests/tenant-approval*','docs/qa/tenant-approvals-recovery.md','src/app/api/approvals/**','src/lib/approval*.ts','src/lib/automation.ts','src/lib/hcm-business-process.ts','src/lib/access.ts','src/lib/auth.ts','src/db/**']}},permissions:{contents:'read'},concurrency:{group:'approval-recovery-${{ github.event.pull_request.number }}','cancel-in-progress':true},jobs};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const text=yaml.dump(recoveryWorkflow(),{lineWidth:-1,noRefs:true});
 if(process.argv.includes('--write'))writeFileSync(OUTPUT,text);
 else assert.deepEqual(yaml.load(readFileSync(OUTPUT,'utf8')),recoveryWorkflow(),'Recovery workflow drift');
}
