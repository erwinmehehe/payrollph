/** Reuse reviewed proof recipes without editing their historical workflow inputs. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import yaml from 'js-yaml';

export const OUTPUT='.github/workflows/wage-registry-renewal.yml';
export const RECIPES={
 security:['security-http-smoke.yml',['change-scope','security-http-acceptance']],
 dl02:['tenant-dl02-qa.yml'],
 table:['tenant-table-proof.yml'],
 statutory:['tenant-compliance-post-candidate.yml'],
 yearend:['tenant-year-end-post-candidate.yml'],
 approvals:['tenant-approvals-recovery.yml',['fictional-approval-http','fictional-approval-sources-http','fictional-approval-flows-http','approval-types-http','money-lifecycle-pg16']],
 enterprise:['tenant-enterprise-admin-http.yml'],
 identity:['tenant-identity-account-http.yml'],
 bir:['bir-1604c-candidate-qa.yml',['synthetic']],
 filing:['tenant-filing-patch-method-qa.yml'],
 labor:['tenant-labor-inspection-post-http.yml'],
 remittance:['remittance-action-tenant-isolation.yml'],
 onboarding:['tenant-onboarding-http.yml'],
 migrations:['tenant-requested-migrations-http.yml'],
 spend:['tenant-spend-write-actions-http.yml'],
 triage:['tenant-studio-triage-qa.yml'],
 draft:['tenant-studio-draft-qa.yml'],
 execution:['tenant-studio-execution-qa.yml'],
 language:['tenant-studio-language-qa.yml'],
 lifecycle:['tenant-studio-lifecycle-qa.yml'],
 scope:['tenant-studio-recovery-scope-qa.yml'],
 resolution:['tenant-studio-resolution-qa.yml'],
 sessions:['tenant-automation-session-ownership.yml'],
 oracle:['payroll-run-oracle.yml'],
 payroll:['payroll-run-credit-renewal.yml'],
 exports:['tenant-payroll-exports-post-http.yml'],
 paymongo:['paymongo-export-isolation.yml'],
};

function renameNeeds(value,prefix){
 if(typeof value==='string')return value.replace(/needs\.([a-zA-Z0-9_-]+)/g,(_,id)=>'needs.'+prefix+'__'+id);
 if(Array.isArray(value))return value.map(x=>renameNeeds(x,prefix));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,renameNeeds(v,prefix)]));
 return value;
}
export function renewalWorkflow(read=readFileSync){
 const jobs={};
 for(const [family,[file,selected]]of Object.entries(RECIPES)){
  const recipe=yaml.load(read('.github/workflows/'+file,'utf8'));
  for(const [id,original]of Object.entries(recipe.jobs)){
   if(selected&&!selected.includes(id))continue;
   const job=renameNeeds(structuredClone(original),family);
   if(job.needs)job.needs=(Array.isArray(original.needs)?original.needs:[original.needs]).map(x=>family+'__'+x);
   job.name='Wage renewal / '+family+' / '+(original.name||id);
   if(recipe.env)job.env={...recipe.env,...job.env};
   const checkout=job.steps?.findIndex(x=>x.uses?.startsWith('actions/checkout@'));
   if(checkout>=0){
    job.steps[checkout].with={...job.steps[checkout].with,'persist-credentials':false,ref:'${{ github.event.pull_request.head.sha }}'};
    job.steps.splice(checkout+1,0,{name:'Verify exact proposed renewal source',env:{WAGE_RENEWAL_EXPECTED_HEAD:'${{ github.event.pull_request.head.sha }}'},run:'test "$(git rev-parse HEAD)" = "$WAGE_RENEWAL_EXPECTED_HEAD"'});
   }else assert.ok(job.needs?.length,'Only a result aggregator may omit checkout: '+family+' '+id);
   jobs[family+'__'+id]=job;
  }
 }
 for(const job of Object.values(jobs))for(const needed of job.needs||[])assert.ok(jobs[needed],'Missing original scheduling prerequisite: '+needed);
 return {name:'Wage-held 75-method source renewal (fictional PG16 HTTP)',on:{pull_request:{branches:['main'],types:['opened','synchronize','reopened'],paths:[OUTPUT,'scripts/qa/wage-registry-renewal-*','tests/wage-registry-renewal*']}},
  permissions:{contents:'read',actions:'read'},concurrency:{group:'wage-source-renewal-${{ github.event.pull_request.number }}','cancel-in-progress':true},jobs};
}
export function generatedWorkflow(){return '# Generated from existing proof recipes; never edit by hand.\n'+yaml.dump(renewalWorkflow(),{lineWidth:-1,noRefs:true,quotingType:"'"});}
if(process.argv.includes('--write')){writeFileSync(OUTPUT,generatedWorkflow());console.log('Generated '+Object.keys(renewalWorkflow().jobs).length+' original proof jobs; zero credits');}
if(process.argv.includes('--check')){assert.equal(readFileSync(OUTPUT,'utf8'),generatedWorkflow(),'Renewal jobs must exactly match the reviewed original recipes');console.log('Renewal recipe parity PASS');}
