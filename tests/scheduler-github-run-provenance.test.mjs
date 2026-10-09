import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {ProvenanceError, verifyRunProvenance} from '../scripts/verify-scheduler-github-runs.mjs';

const SHA = 'a'.repeat(40);
const MAIN_SHA = 'b'.repeat(40);
const TOKEN = 'synthetic-only-not-a-github-token';
const stamp = hour => new Date(Date.UTC(2026, 9, 9, hour, 0, 0)).toISOString();
const observation = (phase, id, hour) => ({
  phase, runUrl: 'https://github.com/erwinmehehe/payrollph/actions/runs/' + id,
  observedAt: stamp(hour), deploymentSha: SHA, deploymentEnvironment: 'preview',
  httpStatus: phase === 'enabled' ? 200 : 503,
  schedulerState: phase === 'enabled' ? 'healthy' : 'scheduler-disabled',
  runConclusion: 'success',
});
const good = () => ({
  schemaVersion:1, repository:'erwinmehehe/payrollph', environment:'payroll-staging',
  deploymentSha:SHA, observations:[
    observation('disabled','1001',1),observation('enabled','1002',2),observation('disabled','1003',3),
  ],
});
function mock({mutateRun, mutateWorkflow, mutateJobs, mutateApprovals, status = 200, contentType='application/json'}={}) {
  const calls=[];
  const fetcher=async(url, options)=>{
    calls.push({url, options});
    const match=url.match(/\/actions\/runs\/([0-9]+)/);
    const id=match?.[1] ?? '1001';
    const hour=Number(id)-1000;
    let body;
    if (url.includes('/workflows/')) {
      body={name:'Payroll Scheduler Staging Health (Manual)',
        path:'.github/workflows/scheduler-staging-health.yml'};
      if (mutateWorkflow) body=mutateWorkflow(body,id);
    } else if (url.endsWith('/approvals')) {
      body=[{state:'approved',environments:[{name:'payroll-staging'}],
        user:{login:'independent-ops-reviewer',type:'User'}}];
      if (mutateApprovals) body=mutateApprovals(body,id);
    } else if (url.endsWith('/jobs?per_page=10')) {
      body={total_count:2,jobs:[
        {name:'verifier-unit-tests',status:'completed',conclusion:'success',steps:[]},
        {name:'read-only-staging-check',run_id:Number(id),head_sha:MAIN_SHA,
         status:'completed',conclusion:'success',
         steps:[{name:'Verify protected staging scheduler liveness',status:'completed',conclusion:'success'}]},
      ]};
      if (mutateJobs) body=mutateJobs(body,id);
    } else {
      body={id:Number(id),name:'Payroll Scheduler Staging Health (Manual)',
        event:'workflow_dispatch',head_branch:'main',head_sha:MAIN_SHA,actor:{login:'stage-operator'},
        status:'completed',conclusion:'success',run_attempt:1,workflow_id:3825,
        path:'.github/workflows/scheduler-staging-health.yml',
        run_started_at:new Date(Date.UTC(2026,9,9,hour,0)-60000).toISOString(),
        updated_at:new Date(Date.UTC(2026,9,9,hour,0)+60000).toISOString()};
      if (mutateRun) body=mutateRun(body,id);
    }
    return new Response(JSON.stringify(body), {
      status,
      headers: {'content-type':contentType},
    });
  };
  return {calls,fetcher};
}
const expectCode=async(promise, code) => {
  await assert.rejects(promise, e=>e instanceof ProvenanceError && e.code===code);
};

test('verifies three genuine-shaped runs and job metadata using only pinned GitHub GETs', async()=>{
  const {calls,fetcher}=mock();
  assert.deepEqual(await verifyRunProvenance(good(),{fetcher,token:TOKEN}),{
    verifiedRunMetadata:3,verifiedMonitorJobs:3,verifiedStageReviewHistory:3,independentApprovalStillRequired:true,
  });
  assert.equal(calls.length,12);
  assert.ok(calls.every(c=>c.url.startsWith('https://api.github.com/repos/erwinmehehe/payrollph/actions/')));
  assert.ok(calls.every(c=>c.options.method==='GET'&&c.options.redirect==='error'&&c.options.cache==='no-store'));
  assert.ok(calls.every(c=>c.options.headers.Authorization==='Bearer '+TOKEN));
  assert.ok(calls.every(c=>!c.url.includes(TOKEN)));
  assert.ok(!JSON.stringify(calls.map(c=>c.url)).includes('staging.example'));
});
test('requires explicitly supplied read-only token before networking', async()=>{
  let called=false;
  await expectCode(verifyRunProvenance(good(),{
    fetcher:async()=>{called=true;throw Error('should not connect');},
  }), 'GITHUB_ACTIONS_READ_TOKEN_REQUIRED');
  assert.equal(called,false);
});
test('rejects failed, push-triggered, rerun and non-main workflow runs', async()=>{
  for(const patch of [
    {conclusion:'failure'},{event:'push'},{run_attempt:2},{head_branch:'staging'},
    {path:'.github/workflows/other.yml'},{name:'Different workflow'},
  ]) {
    const {fetcher}=mock({mutateRun:(run)=>({...run,...patch})});
    await expectCode(verifyRunProvenance(good(),{fetcher,token:TOKEN}), 'GITHUB_RUN_PROVENANCE_MISMATCH');
  }
});
test('disallows three observations from differing workflow revisions', async()=>{
  const {fetcher}=mock({mutateRun:(run,id)=>({...run,head_sha:id==='1002'?'c'.repeat(40):run.head_sha})});
  await expectCode(verifyRunProvenance(good(),{fetcher,token:TOKEN}), 'GITHUB_WORKFLOW_REVISION_CHANGED');
});
test('run timestamp must contain claimed observation within bounded window', async()=>{
  const {fetcher}=mock({mutateRun:(run)=>({...run,run_started_at:'2026-10-08T01:00:00.000Z',updated_at:'2026-10-08T01:02:00.000Z'})});
  await expectCode(verifyRunProvenance(good(),{fetcher,token:TOKEN}), 'GITHUB_RUN_TIMESTAMP_MISMATCH');
});
test('workflow and monitor job identities are verified separately', async()=>{
  const badWorkflow=mock({mutateWorkflow:body=>({...body,path:'.github/workflows/unrelated.yml'})});
  await expectCode(verifyRunProvenance(good(),{fetcher:badWorkflow.fetcher,token:TOKEN}),
    'GITHUB_WORKFLOW_IDENTITY_MISMATCH');
  const badJob=mock({mutateJobs:body=>({...body,jobs:body.jobs.filter(job=>job.name!=='read-only-staging-check')})});
  await expectCode(verifyRunProvenance(good(),{fetcher:badJob.fetcher,token:TOKEN}),
    'GITHUB_MONITOR_JOB_NOT_PROVEN');
  const badStep=mock({mutateJobs:body=>({...body,jobs:body.jobs.map(job=>job.name==='read-only-staging-check'
    ? {...job,steps:[{name:'Verify protected staging scheduler liveness',conclusion:'skipped'}]} : job)})});
  await expectCode(verifyRunProvenance(good(),{fetcher:badStep.fetcher,token:TOKEN}),
    'GITHUB_MONITOR_JOB_NOT_PROVEN');
});
test('fails closed on unauthenticated or non-JSON GitHub API responses',async()=>{
  await expectCode(verifyRunProvenance(good(),{token:TOKEN,fetcher:mock({status:403}).fetcher}),
    'GITHUB_RUN_LOOKUP_FAILED');
  await expectCode(verifyRunProvenance(good(),{token:TOKEN,
    fetcher:mock({contentType:'text/html'}).fetcher}), 'GITHUB_RUN_LOOKUP_FAILED');
});
test('CLI requires token and emits fixed error without paths, inputs or token',()=>{
  const dir=mkdtempSync(join(tmpdir(),'scheduler-run-proof-'));
  const path=join(dir,'run-evidence.json');
  const script=fileURLToPath(new URL('../scripts/verify-scheduler-github-runs.mjs',import.meta.url));
  try{
    writeFileSync(path,JSON.stringify(good()));
    const env={...process.env}; delete env.GH_TOKEN;
    const run=spawnSync(process.execPath,[script,path],{encoding:'utf8',env});
    assert.equal(run.status,1);
    assert.match(run.stderr,/FAIL: GITHUB_ACTIONS_READ_TOKEN_REQUIRED/);
    assert.ok(!run.stderr.includes(path));
    assert.ok(!run.stderr.includes('actions/runs/1001'));
  }finally{rmSync(dir,{recursive:true,force:true});}
});


test('rejects job metadata for a different workflow run or source commit', async()=>{
  const mismatchedRun=mock({mutateJobs:body=>({...body,jobs:body.jobs.map(job=>
    job.name==='read-only-staging-check'?{...job,run_id:999999}:job)})});
  await expectCode(verifyRunProvenance(good(),{token:TOKEN,fetcher:mismatchedRun.fetcher}),
    'GITHUB_MONITOR_JOB_NOT_PROVEN');
  const mismatchedSha=mock({mutateJobs:body=>({...body,jobs:body.jobs.map(job=>
    job.name==='read-only-staging-check'?{...job,head_sha:'d'.repeat(40)}:job)})});
  await expectCode(verifyRunProvenance(good(),{token:TOKEN,fetcher:mismatchedSha.fetcher}),
    'GITHUB_MONITOR_JOB_NOT_PROVEN');
});

test('checks the selected scheduler mode if GitHub exposes dispatch inputs', async()=>{
  const proper=mock({mutateRun:(run,id)=>({...run,inputs:{
    expected_scheduler_state:id==='1002'?'enabled':'disabled',
  }})});
  assert.equal((await verifyRunProvenance(good(),{token:TOKEN,fetcher:proper.fetcher})).verifiedRunMetadata,3);
  const wrong=mock({mutateRun:run=>({...run,inputs:{expected_scheduler_state:'enabled'}})});
  await expectCode(verifyRunProvenance(good(),{token:TOKEN,fetcher:wrong.fetcher}),
    'GITHUB_DISPATCH_PHASE_MISMATCH');
});

test('rejects oversized GitHub JSON during streaming without echoing untrusted data',async()=>{
  const {fetcher}=mock();
  const giant='DO-NOT-PRINT-THIS-NETWORK-DATA'.repeat(21000);
  const oversized=async(url,options)=>{
    const response=await fetcher(url,options);
    if (url.endsWith('/actions/runs/1001')) {
      return new Response(JSON.stringify({large:giant}),{
        status:200,headers:{'content-type':'application/json'},
      });
    }
    return response;
  };
  await expectCode(verifyRunProvenance(good(),{token:TOKEN,fetcher:oversized}),
    'GITHUB_API_RESPONSE_OVERSIZED');
});

test('rejects declared oversized Content-Length before reading response body', async()=>{
  const response={
    status:200,
    headers:{get:key=>key==='content-type'?'application/json':'900000'},
    body:{getReader:()=>{throw Error('must not read');}},
  };
  await expectCode(verifyRunProvenance(good(),{token:TOKEN,fetcher:async()=>response}),
    'GITHUB_API_RESPONSE_OVERSIZED');
});


test('requires documented independent payroll-staging environment approval for every run', async()=>{
  const badSamples=[
    [],
    [{state:'approved',environments:[{name:'production'}],user:{login:'independent-ops-reviewer',type:'User'}}],
    [{state:'rejected',environments:[{name:'payroll-staging'}],user:{login:'independent-ops-reviewer',type:'User'}}],
    [{state:'approved',environments:[{name:'payroll-staging'}],user:{login:'stage-operator',type:'User'}}],
    [{state:'approved',environments:[{name:'payroll-staging'}],user:null}],
    [{state:'approved',environments:[],user:{login:'independent-ops-reviewer',type:'User'}}],
  ];
  for(const approvals of badSamples) {
    const {fetcher}=mock({mutateApprovals:()=>approvals});
    await expectCode(verifyRunProvenance(good(),{token:TOKEN,fetcher}),
      approvals.length===0?'GITHUB_PROTECTED_ENVIRONMENT_APPROVAL_MISSING':'GITHUB_INDEPENDENT_STAGE_REVIEW_NOT_PROVEN');
  }
});

test('requires a human User rather than a bot or a type-less reviewer', async()=>{
  for (const user of [
    {login:'independent-ops-reviewer',type:'Bot'},
    {login:'independent-ops-reviewer'},
    {login:'stage-operator',type:'User'},
  ]) {
    const {fetcher}=mock({mutateApprovals:()=>[
      {state:'approved',environments:[{name:'payroll-staging'}],user},
    ]});
    await expectCode(verifyRunProvenance(good(),{token:TOKEN,fetcher}),
      'GITHUB_INDEPENDENT_STAGE_REVIEW_NOT_PROVEN');
  }
});

test('an approval for payroll-staging cannot be overridden by a rejection',async()=>{
  const {fetcher}=mock({mutateApprovals:()=>[
    {state:'approved',environments:[{name:'payroll-staging'}],user:{login:'independent-reviewer',type:'User'}},
    {state:'rejected',environments:[{name:'payroll-staging'}],user:{login:'another-reviewer',type:'User'}},
  ]});
  await expectCode(verifyRunProvenance(good(),{token:TOKEN,fetcher}),
    'GITHUB_INDEPENDENT_STAGE_REVIEW_NOT_PROVEN');
});

test('rejects missing triggering actor rather than assuming review independence',async()=>{
  const {fetcher}=mock({mutateRun:run=>({...run,actor:null})});
  await expectCode(verifyRunProvenance(good(),{token:TOKEN,fetcher}),'GITHUB_RUN_ACTOR_INVALID');
});

test('rejects inaccessible approvals API and malformed review-history payload',async()=>{
  const missing=mock();
  const noAccess=async(url,opt)=>url.endsWith('/approvals')
    ? new Response('{}',{status:403,headers:{'content-type':'application/json'}})
    : missing.fetcher(url,opt);
  await expectCode(verifyRunProvenance(good(),{token:TOKEN,fetcher:noAccess}),
    'GITHUB_RUN_LOOKUP_FAILED');
  const badShape=mock({mutateApprovals:()=>({state:'approved'})});
  await expectCode(verifyRunProvenance(good(),{token:TOKEN,fetcher:badShape.fetcher}),
    'GITHUB_API_RESPONSE_INVALID');
});
