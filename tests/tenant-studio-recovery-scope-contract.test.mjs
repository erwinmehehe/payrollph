import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import yaml from 'js-yaml';
import {REQUIRED,SOURCE_PINS,requireScopeEnv,verifyScopeSources,assertOwnedRecovery} from '../scripts/qa/tenant-studio-recovery-scope-contract.mjs';
const env={...REQUIRED,DATABASE_URL:'postgresql://postgres:postgres@127.0.0.1:5432/app_db',APP_BASE_URL:'http://127.0.0.1:3000',TRUSTED_APP_ORIGINS:'http://127.0.0.1:3000',SECURITY_SMOKE_URL:'http://127.0.0.1:3000'};
test('only a disposable loopback recovery proof with providers/money disabled is accepted',()=>{
 assert.equal(requireScopeEnv(env),env.APP_BASE_URL);
 for(const k of Object.keys(REQUIRED))assert.throws(()=>requireScopeEnv({...env,[k]:'unsafe'}),undefined,k);
 for(const value of ['postgresql://postgres:postgres@db.example.invalid:5432/app_db','postgresql://postgres:postgres@127.0.0.1:5432/real_db'])assert.throws(()=>requireScopeEnv({...env,DATABASE_URL:value}));
 assert.throws(()=>requireScopeEnv({...env,OPENAI_API_KEY:'fictional-forbidden'}));
});
test('all recovery source inputs are sealed and changed bytes fail closed',()=>{
 verifyScopeSources();
 for(const p of Object.keys(SOURCE_PINS))assert.throws(()=>verifyScopeSources(path=>path===p?Buffer.concat([readFileSync(path),Buffer.from(' changed')]):readFileSync(path)),/source drift/,p);
});
test('positive oracle rejects foreign, missing, failed and unpersisted execution results',()=>{
 const actor={org:{id:3},worker:{id:7}},source={id:9,ruleId:4};
 const execution={id:9,organizationId:3,employeeId:7,ruleId:4,status:'completed'};
 assertOwnedRecovery({status:200,json:{execution}},actor,source,'retry-execution-step',execution);
 for(const key of ['organizationId','employeeId','ruleId'])assert.throws(()=>assertOwnedRecovery({status:200,json:{execution:{...execution,[key]:99}}},actor,source,'retry-execution-step',{...execution,[key]:99}),/accepts another employer's data/);
 assert.throws(()=>assertOwnedRecovery({status:200,json:{execution:{...execution,status:'failed'}}},actor,source,'retry-execution-step',execution));
 assert.throws(()=>assertOwnedRecovery({status:200,json:{execution}},actor,source,'retry-execution-step',{...execution,status:'failed'}));
});
test('dedicated PG16 workflow preserves exact-head, disabled-provider and receipt gates',()=>{
 const workflow=yaml.load(readFileSync('.github/workflows/tenant-studio-recovery-scope-qa.yml','utf8'));
 const job=workflow.jobs['stored-recovery-scope'];assert.equal(job.services.postgres.image,'postgres:16');
 for(const [key,value]of Object.entries(REQUIRED))assert.equal(job.env[key],value,key);
 assert.equal(job.steps.find(x=>x.uses?.startsWith('actions/checkout@')).with.ref,'${{ github.event.pull_request.head.sha || github.sha }}');
 assert.ok(job.steps.some(x=>x.run==='node --import tsx scripts/qa/tenant-studio-recovery-scope-http.mjs'));
 assert.equal(job.steps.find(x=>x.uses?.startsWith('actions/upload-artifact@')).with['if-no-files-found'],'error');
 assert.doesNotMatch(JSON.stringify(workflow),/secrets\.|continue-on-error/);
 assert.notEqual(workflow.concurrency.group,yaml.load(readFileSync('.github/workflows/tenant-studio-language-qa.yml','utf8')).concurrency.group);
});
test('renewal jobs preserve original HTTP/DB recipes; historical guards remain in their original workflows',()=>{
 const read=p=>yaml.load(readFileSync(p,'utf8'));
 const renewal=read('.github/workflows/tenant-studio-dependency-renewal.yml');
 for(const [name,path,oldName,creditStep]of [
  ['renew-document-callers','.github/workflows/tenant-document-caller-reproof.yml','caller-reproof',s=>s.run==='node --test tests/tenant-document-caller-reproof.test.mjs'],
  ['renew-spend-managed','.github/workflows/tenant-spend-write-actions-http.yml','spend-full-write-method',s=>s.name==='Fail-closed exact-source and action contract'],
  ['renew-approval-task','.github/workflows/tenant-approvals-recovery.yml','fictional-approval-http',s=>s.run?.includes('tests/tenant-approval-task-tx-org-scope.test.mjs')],
 ]){
  const original=read(path).jobs[oldName],job=renewal.jobs[name];assert.ok(job);
  assert.deepEqual(job.env,original.env);assert.deepEqual(job.services,original.services);
  assert.equal(job.steps.find(s=>s.uses?.startsWith('actions/checkout@')).with.ref,'${{ github.event.pull_request.head.sha || github.sha }}');
  for(const step of original.steps)if(step.run&&!creditStep(step))assert.ok(job.steps.some(s=>s.run===step.run),'Lost original guarded recipe '+name+': '+step.name);
  assert.ok(original.steps.some(creditStep),'Original historical guard must remain mandatory');
 }
 assert.doesNotMatch(JSON.stringify(renewal),/secrets\.|continue-on-error/);
});
