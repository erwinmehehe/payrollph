import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {
  ObserverError,selectScheduledRuns,assessScheduledRunEvidence,collectScheduledRunEvidence,main,
} from '../scripts/observe-scheduler-run-provenance.mjs';
import {checkSchedulerResponse,checkDisabledSchedulerResponse} from '../scripts/check-scheduler-staging-health.mjs';

const now=new Date('2026-10-13T12:00:00.000Z');
const SHA='a'.repeat(40);
const PATH='.github/workflows/production-scheduler-tick.yml';
function run(id,minutesAgo) {
  return {id,name:'Production Scheduler Tick (External, Default OFF)',event:'schedule',
    head_branch:'main',path:PATH,workflow_id:1234,run_attempt:1,
    head_sha:SHA,status:'completed',conclusion:'skipped',
    created_at:new Date(now.getTime()-minutesAgo*60000).toISOString(),
    updated_at:new Date(now.getTime()-(minutesAgo-1)*60000).toISOString()};
}
const three=()=>[run(101,5),run(102,10),run(103,15)];
function jobs(runs,mode='skipped') {
  return new Map(runs.map(r=>[r.id,[{name:'tick',run_id:r.id,head_sha:r.head_sha,
    status:'completed',conclusion:mode,
    steps:mode==='success'?[{name:'Dispatch one protected production scheduler tick',status:'completed',conclusion:'success'}]:[]}]]));
}
function api(runs,byRun=jobs(runs)) {
  const seen=[];
  const fetcher=async(url,options)=>{
    seen.push({url,options});
    const match=url.match(/\/actions\/runs\/(\d+)\/jobs/);
    const body=match ? {total_count:1,jobs:byRun.get(Number(match[1]))}
      : {total_count:runs.length,workflow_runs:runs};
    return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
  };
  return {seen,fetcher};
}
const TOKEN='synthetic-read-only-token-just-for-unit-tests';
function expectCode(fn,code) {assert.throws(fn,e=>e instanceof ObserverError&&e.code===code);}
async function expectAsyncCode(fn,code) {await assert.rejects(fn,e=>e instanceof ObserverError&&e.code===code);}

test('no scheduled events is a clearly blocked operational state, not a fake pass',()=>{
  const r=assessScheduledRunEvidence([],new Map(),now);
  assert.equal(r.state,'no-scheduled-runs-in-window');
  assert.equal(r.scheduledEventCount,0);
  assert.equal(r.threeDistinctScheduledEventsProven,false);
  assert.equal(r.productionSchedulerActivationAuthorized,false);
});
test('three genuine scheduled events with skipped tick jobs prove schedule delivery but not dispatch',()=>{
  const runs=three();const r=assessScheduledRunEvidence(runs,jobs(runs),now);
  assert.equal(r.state,'scheduled-events-observed-dispatch-disabled');
  assert.equal(r.threeDistinctScheduledEventsProven,true);
  assert.equal(r.threeDispatchStepSuccessesProven,false);
  assert.equal(r.deploymentHeartbeatProven,false);
  assert.equal(r.productionSchedulerActivationAuthorized,false);
});
test('three successful dispatch steps still do not prove deployed heartbeat or hosted worker',()=>{
  const runs=three().map(r=>({...r,conclusion:'success'}));const r=assessScheduledRunEvidence(runs,jobs(runs,'success'),now);
  assert.equal(r.state,'dispatch-step-success-heartbeat-unverified');
  assert.equal(r.threeDispatchStepSuccessesProven,true);
  assert.equal(r.deploymentHeartbeatProven,false);
  assert.equal(r.hostedWorkerHeartbeatProven,false);
  assert.equal(r.independentMissedTickAlertProven,false);
  assert.equal(r.productionSchedulerActivationAuthorized,false);
});
test('two runs or mixed skip/success never prove complete active dispatch',()=>{
  assert.equal(assessScheduledRunEvidence(three().slice(0,2),jobs(three()),now).threeDistinctScheduledEventsProven,false);
  const runs=three().map((x,i)=>({...x,conclusion:i===0?'success':'skipped'}));
  const map=jobs(runs);map.get(101)[0]={...map.get(101)[0],conclusion:'success',steps:[{name:'Dispatch one protected production scheduler tick',status:'completed',conclusion:'success'}]};
  assert.equal(assessScheduledRunEvidence(runs,map,now).state,'mixed-scheduled-results-not-proven');
});
test('rejects fake schedule event, manual trigger, wrong workflow, wrong SHA, reruns, and future timestamps',()=>{
  for(const patch of [
    {event:'workflow_dispatch'},{event:'push'},{head_branch:'other'},
    {path:'.github/workflows/ci.yml'},{name:'CodeQL Security'},
    {head_sha:'bad'},{run_attempt:2},
  ]) expectCode(()=>selectScheduledRuns([{...run(101,5),...patch}],now),'SCHEDULE_IDENTITY_NOT_VERIFIED');
  expectCode(()=>selectScheduledRuns([{...run(101,5),created_at:new Date(now.getTime()+120000).toISOString()}],now),'INVALID_RUN_TIMESTAMP');
  expectCode(()=>selectScheduledRuns([run(101,5),run(101,10)],now),'DUPLICATE_OR_INVALID_RUN_ID');
  expectCode(()=>selectScheduledRuns([run(101,5),run(102,5),run(103,10)],now),'SCHEDULE_TIMESPACING_NOT_VERIFIED');
});
test('rejects stale jobs, mismatched run IDs, and falsely successful receipts',()=>{
  const runs=three();let map=jobs(runs);
  map.get(101)[0].run_id=999;
  expectCode(()=>assessScheduledRunEvidence(runs,map,now),'TICK_JOB_NOT_VERIFIED');
  map=jobs(runs);map.get(101)[0].conclusion='success';
  expectCode(()=>assessScheduledRunEvidence(runs,map,now),'TICK_JOB_RESULT_NOT_VERIFIED');
  map=jobs(runs);map.get(101)[0].head_sha='b'.repeat(40);
  expectCode(()=>assessScheduledRunEvidence(runs,map,now),'TICK_JOB_NOT_VERIFIED');
});
test('only fixed GitHub read URLs with GET; never POST, token in URL, or a deployed endpoint',async()=>{
  const runs=three();const {fetcher,seen}=api(runs);
  const r=await collectScheduledRunEvidence({token:TOKEN,fetcher,now});
  assert.equal(r.threeDistinctScheduledEventsProven,true);
  assert.equal(seen.length,4);
  for(const call of seen){
    assert.equal(call.options.method,'GET');
    assert.equal(call.options.redirect,'error');
    assert.equal(call.options.headers.Authorization,'Bearer '+TOKEN);
    assert.ok(call.url.startsWith('https://api.github.com/repos/erwinmehehe/payrollph/actions/'));
    assert.ok(!call.url.includes(TOKEN));
    assert.ok(!call.url.includes('/api/jobs/tick'));
  }
});
test('refuses empty token, non-JSON, HTTP error or oversized content before accepting evidence',async()=>{
  let called=false;
  await expectAsyncCode(()=>collectScheduledRunEvidence({now,fetcher:async()=>{called=true;throw Error('network');}}),
    'READ_ONLY_ACTIONS_TOKEN_REQUIRED');
  assert.equal(called,false);
  for(const fetcher of [
    async()=>new Response('{}',{status:403,headers:{'content-type':'application/json'}}),
    async()=>new Response('not json',{status:200,headers:{'content-type':'text/plain'}}),
    async()=>new Response('{}',{status:200,headers:{'content-type':'application/json','content-length':'2000000'}}),
  ]) await assert.rejects(()=>collectScheduledRunEvidence({now,fetcher,token:TOKEN}),e=>e instanceof ObserverError);
});
test('observer refuses local use and never writes a report for untrusted contexts',async()=>{
  await expectAsyncCode(()=>main({GITHUB_ACTIONS:'false',GITHUB_REPOSITORY:'erwinmehehe/payrollph',GITHUB_EVENT_NAME:'schedule'},
    async()=>{throw Error('network blocked');},now),'TRUSTED_OBSERVER_CONTEXT_REQUIRED');
});
test('read-only deployed heartbeat evaluator rejects overdue, failed, missing lease and disabled mismatch',()=>{
  const healthy={ok:true,state:'healthy',lastSuccessfulRunAt:new Date(now.getTime()-90000).toISOString(),secondsSinceSuccess:90,lastLeaseStatus:'completed'};
  assert.equal(checkSchedulerResponse(200,healthy,now).ok,true);
  for(const bad of [{...healthy,secondsSinceSuccess:800},{...healthy,lastLeaseStatus:'failed'},
    {...healthy,lastSuccessfulRunAt:new Date(now.getTime()-720000).toISOString()},
    {...healthy,lastLeaseStatus:null}]) assert.equal(checkSchedulerResponse(200,bad,now).ok,false);
  assert.equal(checkDisabledSchedulerResponse(503,{ok:false,state:'scheduler-disabled'}).ok,true);
  assert.equal(checkDisabledSchedulerResponse(200,healthy).ok,false);
});
test('workflow is automated read-only and never enables runtime or mutating dispatch',()=>{
  const flow=readFileSync('.github/workflows/scheduler-scheduled-run-observer.yml','utf8');
  assert.match(flow,/schedule:/);
  assert.match(flow,/github.event_name == 'push'/);
  assert.match(flow,/pull_request:/);
  assert.match(flow,/actions: read/);
  assert.match(flow,/observe-scheduler-run-provenance\.mjs/);
  assert.match(flow,/GITHUB_TOKEN: \$\{\{ github.token \}\}/);
  assert.doesNotMatch(flow,/POST \/api\/jobs\/tick|CENTRAL_SCHEDULER_ENABLED: "true"|PAYROLL_SCHEDULER_DISPATCH_ENABLED: "true"/);
  assert.doesNotMatch(flow,/environment: payroll-scheduler-production/);
});
