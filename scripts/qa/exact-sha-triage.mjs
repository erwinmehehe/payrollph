#!/usr/bin/env node
import {mkdirSync,writeFileSync} from 'node:fs';

export const CHECKS=[
 ['CI','ci.yml'],['CodeQL Security','codeql.yml'],
 ['Security HTTP Smoke','security-http-smoke.yml'],
 ['Payout Payroll Isolation','payout-payroll-isolation.yml'],
 ['Production Pilot Payroll QA','pilot-payroll-qa.yml'],
 ['Nine-Stage Connected Payroll Development Acceptance (No Money)','nine-stage-connected-acceptance.yml'],
 ['WFM 14-Scenario Synthetic Evidence Matrix','wfm-pilot-synthetic-evidence.yml']
];
const fullSha=/^[0-9a-f]{40}$/;
const apiRoot='https://api.github.com/repos/erwinmehehe/payrollph/';
export function summarize(sha,runs,jobIds={}) {
 if(!fullSha.test(sha)||!Array.isArray(runs)) throw Error('Invalid SHA or runs');
 const entries=CHECKS.map(([name,file])=>{
   const run=runs.filter(x=>x.head_sha===sha&&x.path?.endsWith('/'+file)&&Number.isSafeInteger(x.id))
     .sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)||b.id-a.id)[0];
   let status=!run?'NOT_TRIGGERED':run.status!=='completed'?'RUNNING':
     run.conclusion==='success'?'PASS':['skipped','neutral'].includes(run.conclusion)?'SKIPPED':'FAILED';
   const url=run?'https://github.com/erwinmehehe/payrollph/actions/runs/'+run.id:null;
   const job=run&&status==='FAILED'?jobIds[run.id]:null;
   return {name,status,runUrl:url,jobUrl:job?url+'/job/'+job:null};
 });
 return {schema:'payrollph-qa-triage-v1',sourceSha:sha,
  advisoryOnly:true,releaseAuthorization:'NO_GO_NOT_EVALUATED',
  humanAcceptance:'NOT_RUN_EXTERNAL',queryLimit:'first 100 matching runs; missing is not proof of never executed',entries};
}
export function render(report) {
 const lines=['# PayrollPH exact-SHA QA overview','',
  'Commit: `'+report.sourceSha+'`','',
  '**Advisory only. No production, human acceptance, real payroll, payout or filing certification.**','',
  '| Workflow | Status | Evidence |','|---|---|---|'];
 for(const x of report.entries) lines.push('| '+x.name+' | '+x.status+' | '+
   (x.runUrl?'[Run]('+x.runUrl+')'+(x.jobUrl?' / [Failed job]('+x.jobUrl+')':''):'Not triggered in queried window')+' |');
 const f=report.entries.find(x=>x.status==='FAILED');
 lines.push('','## First actionable failure','',
  f?f.name+': inspect '+(f.jobUrl||f.runUrl)+'; source regression vs environment cause **unverified**.':
    'No failure shown. This does not mean the release is ready.','','External/human acceptance: **NOT_RUN_EXTERNAL**.','');
 return lines.join('\n');
}
async function request(path,token) {
 const response=await fetch(apiRoot+path,{headers:{Authorization:'Bearer '+token,
 Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},
 signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('GitHub metadata request failed: HTTP '+response.status);
 return response.json();
}
async function main(){
 const sha=process.env.QA_TARGET_SHA,token=process.env.GITHUB_TOKEN;
 if(!fullSha.test(sha||'')||!token)throw Error('Require full lowercase QA_TARGET_SHA and token');
 const commit=await request('commits/'+sha,token);
 if(commit.sha!==sha)throw Error('Commit mismatch');
 const data=await request('actions/runs?head_sha='+sha+'&per_page=100',token);
 if(!Array.isArray(data.workflow_runs))throw Error('Invalid GitHub run payload');
 const runs=data.workflow_runs.filter(r=>r.head_sha===sha);
 const jobIds={};
 for(const r of runs.filter(r=>r.conclusion==='failure'&&CHECKS.some(x=>r.path?.endsWith('/'+x[1]))).slice(0,12)){
   const data=await request('actions/runs/'+r.id+'/jobs?per_page=100',token);
   if(!Array.isArray(data.jobs))throw Error('Invalid GitHub jobs payload');
   jobIds[r.id]=data.jobs.find(j=>j.conclusion==='failure'&&Number.isSafeInteger(j.id))?.id;
 }
 const result=summarize(sha,runs,jobIds);
 mkdirSync('qa-artifacts',{recursive:true});
 writeFileSync('qa-artifacts/qa-triage.json',JSON.stringify(result,null,2)+'\n');
 writeFileSync('qa-artifacts/qa-triage.md',render(result));
 if(process.env.GITHUB_STEP_SUMMARY)writeFileSync(process.env.GITHUB_STEP_SUMMARY,render(result),{flag:'a'});
 console.log('QA_ADVISORY_COMPLETE');
}
if(import.meta.url==='file://'+process.argv[1])main().catch(e=>{console.error(e.message);process.exitCode=1});
