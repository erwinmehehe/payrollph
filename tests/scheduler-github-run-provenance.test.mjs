import assert from "node:assert/strict";
import test from "node:test";
import {spawnSync} from "node:child_process";
import {mkdtempSync, writeFileSync, rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {ProvenanceError, verifyRunProvenance} from "../scripts/verify-scheduler-github-runs.mjs";

const SHA = "a".repeat(40);
const MAIN_SHA = "b".repeat(40);
const TOKEN = "synthetic-only-not-a-github-token";
const stamp = hour => new Date(Date.UTC(2026, 9, 9, hour, 0, 0)).toISOString();
const observation = (phase, id, hour) => ({
  phase, runUrl:"https://github.com/erwinmehehe/payrollph/actions/runs/" + id,
  observedAt:stamp(hour), deploymentSha:SHA, deploymentEnvironment:"preview",
  httpStatus:phase==="enabled"?200:503,
  schedulerState:phase==="enabled"?"healthy":"scheduler-disabled",
  runConclusion:"success",
});
const good = () => ({
  schemaVersion:1, repository:"erwinmehehe/payrollph", environment:"payroll-staging",
  deploymentSha:SHA, observations:[
    observation("disabled","1001",1), observation("enabled","1002",2), observation("disabled","1003",3),
  ],
});
function mock({mutateRun, mutateWorkflow, mutateJobs, status=200, contentType="application/json"}={}) {
  const calls=[];
  const fetcher=async(url,options)=>{
    calls.push({url,options});
    const match=url.match(/\/actions\/runs\/([0-9]+)/);
    const id=match?.[1]??"1001";
    const hour=Number(id)-1000;
    let body;
    if(url.includes("/workflows/")) {
      body={name:"Payroll Scheduler Staging Health (Manual)",
        path:".github/workflows/scheduler-staging-health.yml"};
      if(mutateWorkflow)body=mutateWorkflow(body,id);
    }else if(url.endsWith("/jobs?per_page=10")){
      body={total_count:2,jobs:[
        {name:"verifier-unit-tests",status:"completed",conclusion:"success",steps:[]},
        {name:"read-only-staging-check",status:"completed",conclusion:"success",
          steps:[{name:"Verify protected staging scheduler liveness",conclusion:"success"}]},
      ]};
      if(mutateJobs)body=mutateJobs(body,id);
    }else{
      body={id:Number(id),name:"Payroll Scheduler Staging Health (Manual)",
        event:"workflow_dispatch",head_branch:"main",head_sha:MAIN_SHA,
        status:"completed",conclusion:"success",run_attempt:1,workflow_id:3825,
        path:".github/workflows/scheduler-staging-health.yml",
        run_started_at:new Date(Date.UTC(2026,9,9,hour,0)-60000).toISOString(),
        updated_at:new Date(Date.UTC(2026,9,9,hour,0)+60000).toISOString()};
      if(mutateRun)body=mutateRun(body,id);
    }
    return {status,headers:{get:()=>contentType},text:async()=>JSON.stringify(body)};
  };
  return {calls,fetcher};
}
const expectCode=async(promise,code)=>{
  await assert.rejects(promise,e=>e instanceof ProvenanceError&&e.code===code);
};

test("verifies three workflow runs using only pinned, read-only GitHub GETs",async()=>{
  const {calls,fetcher}=mock();
  assert.deepEqual(await verifyRunProvenance(good(),{fetcher,token:TOKEN}),{
    verifiedRunMetadata:3,verifiedMonitorJobs:3,independentApprovalStillRequired:true,
  });
  assert.equal(calls.length,9);
  assert.ok(calls.every(c=>c.url.startsWith("https://api.github.com/repos/erwinmehehe/payrollph/actions/")));
  assert.ok(calls.every(c=>c.options.method==="GET"&&c.options.redirect==="error"&&c.options.cache==="no-store"));
  assert.ok(calls.every(c=>c.options.headers.Authorization==="Bearer "+TOKEN));
  assert.ok(calls.every(c=>!c.url.includes(TOKEN)));
});
test("requires explicit read-only token before networking",async()=>{
  let called=false;
  await expectCode(verifyRunProvenance(good(),{
    fetcher:async()=>{called=true;throw Error("should not connect");},
  }),"GITHUB_ACTIONS_READ_TOKEN_REQUIRED");
  assert.equal(called,false);
});
test("rejects failed, push-triggered, rerun and non-main runs",async()=>{
  for(const patch of [
    {conclusion:"failure"},{event:"push"},{run_attempt:2},{head_branch:"staging"},
    {path:".github/workflows/other.yml"},{name:"Different workflow"},
  ]){
    const {fetcher}=mock({mutateRun:run=>({...run,...patch})});
    await expectCode(verifyRunProvenance(good(),{fetcher,token:TOKEN}),"GITHUB_RUN_PROVENANCE_MISMATCH");
  }
});
test("refuses observations from differing main workflow revisions",async()=>{
  const {fetcher}=mock({mutateRun:(run,id)=>({...run,head_sha:id==="1002"?"c".repeat(40):run.head_sha})});
  await expectCode(verifyRunProvenance(good(),{fetcher,token:TOKEN}),"GITHUB_WORKFLOW_REVISION_CHANGED");
});
test("run timestamp must contain the claimed observation",async()=>{
  const {fetcher}=mock({mutateRun:run=>({...run,
    run_started_at:"2026-10-08T01:00:00.000Z",updated_at:"2026-10-08T01:02:00.000Z"})});
  await expectCode(verifyRunProvenance(good(),{fetcher,token:TOKEN}),"GITHUB_RUN_TIMESTAMP_MISMATCH");
});
test("checks workflow identity and protected monitoring job separately",async()=>{
  const wrongWorkflow=mock({mutateWorkflow:body=>({...body,path:".github/workflows/other.yml"})});
  await expectCode(verifyRunProvenance(good(),{fetcher:wrongWorkflow.fetcher,token:TOKEN}),
    "GITHUB_WORKFLOW_IDENTITY_MISMATCH");
  const missing=mock({mutateJobs:body=>({...body,jobs:body.jobs.filter(j=>j.name!=="read-only-staging-check")})});
  await expectCode(verifyRunProvenance(good(),{fetcher:missing.fetcher,token:TOKEN}),
    "GITHUB_MONITOR_JOB_NOT_PROVEN");
  const skipped=mock({mutateJobs:body=>({...body,jobs:body.jobs.map(j=>j.name==="read-only-staging-check"
    ? {...j,steps:[{name:"Verify protected staging scheduler liveness",conclusion:"skipped"}]}:j)})});
  await expectCode(verifyRunProvenance(good(),{fetcher:skipped.fetcher,token:TOKEN}),
    "GITHUB_MONITOR_JOB_NOT_PROVEN");
});
test("fails closed on unauthenticated or non-JSON GitHub API responses",async()=>{
  await expectCode(verifyRunProvenance(good(),{token:TOKEN,fetcher:mock({status:403}).fetcher}),
    "GITHUB_RUN_LOOKUP_FAILED");
  await expectCode(verifyRunProvenance(good(),{token:TOKEN,fetcher:mock({contentType:"text/html"}).fetcher}),
    "GITHUB_RUN_LOOKUP_FAILED");
});
test("CLI requires token and emits fixed errors without leaking inputs",()=>{
  const dir=mkdtempSync(join(tmpdir(),"scheduler-run-proof-"));
  const file=join(dir,"run-evidence.json");
  const script=fileURLToPath(new URL("../scripts/verify-scheduler-github-runs.mjs",import.meta.url));
  try{
    writeFileSync(file,JSON.stringify(good()));
    const env={...process.env};delete env.GH_TOKEN;
    const run=spawnSync(process.execPath,[script,file],{encoding:"utf8",env});
    assert.equal(run.status,1);
    assert.match(run.stderr,/FAIL: GITHUB_ACTIONS_READ_TOKEN_REQUIRED/);
    assert.ok(!run.stderr.includes(file));
    assert.ok(!run.stderr.includes("actions/runs/1001"));
  }finally{rmSync(dir,{recursive:true,force:true});}
});
