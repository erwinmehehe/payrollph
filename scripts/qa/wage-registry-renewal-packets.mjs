/** Build native job packets for wage-registry-renewal-v2-capture.mjs from what GitHub shows for one run.
 * Inputs are inspected, not trusted: capture re-validates every family result, every job identity and
 * every source pin at the executed head. This file grants nothing.
 *
 *   node scripts/qa/wage-registry-renewal-packets.mjs <steps.json> <logs.json> [artifacts.json] [outDir]
 *
 * steps.json:     {runId, headSha, jobs:[{jobId,name,conclusion,steps:[{name,conclusion}]}]}  (job pages)
 * logs.json:      {jobs:{<jobId>:extractLogRecords(rawLog)}}                                  (raw job logs)
 * artifacts.json: {<jobId>:[{artifactId,artifactDigest,file,json}]}                           (uploaded results)
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {renewalWorkflow} from './wage-registry-renewal-workflow.mjs';
import {expectedWageJobs} from './wage-registry-renewal-verify.mjs';
import {terminals} from './wage-registry-renewal-results.mjs';

/** Runs unchanged inside the browser on a raw job log (Function.prototype.toString), and in tests here.
 * Keeps every JSON object a step printed (one line or pretty-printed), plus PASS lines and TENANT_ env echoes. */
export function extractLogRecords(text){
 const lines=String(text).split('\n').map(l=>l.replace(/\r$/,'').replace(/^\uFEFF?\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ?/,''));
 const json=[],keep=[],env={};
 for(let i=0;i<lines.length;i++){
  const t=lines[i].trim();
  const m=/^(TENANT_[A-Z0-9_]+): (.+)$/.exec(t);if(m&&!(m[1]in env))env[m[1]]=m[2].trim();
  if(/(?:^|\b)PASS\b|SYNTHETIC_REAL_HTTP_ONLY|tenant-|HTTP|isolat/i.test(t)&&t.length<=600)keep.push(lines[i]);
  // A result is printed bare, after a TAP comment marker ("# {...}") or after an UPPER_CASE token ("X_PASS {...}").
  const p=/^(?:# |[A-Z][A-Z0-9_]*(?: [A-Z0-9_]+)* )?(\{.*)$/.exec(t);
  if(!p)continue;
  let buffer='',done=false;
  for(let j=i;j<lines.length&&j<i+4000;j++){
   buffer+=(j===i?p[1]:'\n'+lines[j]);
   if(!/[}\]]\s*$/.test(lines[j]))continue;
   try{const value=JSON.parse(buffer);if(value&&typeof value==='object'&&!Array.isArray(value)){json.push(value);i=j;}done=true;break;}catch{/* keep reading */}
  }
  if(!done)continue;
 }
 return {json,lines:keep,env};
}

/** GitHub's display name for every reviewed job and matrix leg -> {jobKey, variant}. */
export function jobIdentityByName(){
 const map=new Map();
 for(const [jobKey,job]of Object.entries(renewalWorkflow().jobs)){
  const matrix=job.strategy?.matrix||{};
  const variants=Object.entries(matrix).reduce((all,[k,values])=>all.flatMap(v=>values.map(value=>({...v,[k]:value}))),[{}]);
  for(const variant of variants){
   let name=job.name;
   const templated=/\$\{\{\s*matrix\./.test(name);
   name=name.replace(/\$\{\{\s*matrix\.([A-Za-z0-9_-]+)\s*\}\}/g,(_,k)=>String(variant[k]));
   if(!templated&&Object.keys(variant).length)name+=' ('+Object.values(variant).map(String).join(', ')+')';
   assert.ok(!map.has(name),'Ambiguous job name '+name);
   map.set(name,{jobKey,variant:Object.fromEntries(Object.entries(variant).map(([k,v])=>[k,String(v)]))});
  }
 }
 return map;
}

const METADATA_ONLY=new Set(['security__change-scope','filing__filing-method-all-legs']);
const OBSERVED_FLAGS=Object.freeze({dl02:['TENANT_DL02_PROOF']});

export function buildPackets(steps,logs,artifacts={}){
 const names=jobIdentityByName(),packets=[];
 assert.match(steps.headSha,/^[a-f0-9]{40}$/);assert.ok(Number.isSafeInteger(steps.runId)&&steps.runId>0);
 for(const job of steps.jobs){
  const id=names.get(job.name);assert.ok(id,'Unreviewed job name '+job.name);
  const family=id.jobKey.split('__')[0],metadataOnly=METADATA_ONLY.has(id.jobKey);
  const log=logs.jobs[job.jobId];assert.ok(log||metadataOnly,'Missing log for '+job.name);
  const extra=artifacts[job.jobId]??[];
  const results=[...(log?.json??[]),...extra.map(a=>a.json)];
  const terminalLines=(log?.lines??[]).filter(l=>terminals[family].test(l));
  const packet={jobKey:id.jobKey,variant:id.variant,jobName:job.name,runId:steps.runId,jobId:job.jobId,sourceHead:steps.headSha,
   conclusion:job.conclusion,postgresMajor:metadataOnly?null:16,transport:metadataOnly?'source-metadata-only':'real-http',
   evidence:'https://github.com/erwinmehehe/payrollph/actions/runs/'+steps.runId+'/job/'+job.jobId,
   exactHeadCheckoutVerified:job.steps.some(s=>s.name==='Verify exact proposed renewal source'&&s.conclusion==='success'),
   metadataOnly,steps:job.steps,results,terminalLines};
  const flags=OBSERVED_FLAGS[family];
  if(flags)packet.observedFlags=Object.fromEntries(flags.filter(k=>log?.env?.[k]).map(k=>[k,log.env[k]]));
  if(extra.length)packet.artifacts=extra.map(({artifactId,artifactDigest,file})=>({artifactId,artifactDigest,file}));
  packets.push(packet);
 }
 for(const family of new Set(packets.map(p=>p.jobKey.split('__')[0]))){
  const got=packets.filter(p=>p.jobKey.startsWith(family+'__')).length;
  assert.equal(got,expectedWageJobs(family).length,'Every job and matrix leg of '+family+' is required');
 }
 return packets;
}

const cli=process.argv[1]?.replaceAll('\\','/').endsWith('/wage-registry-renewal-packets.mjs');
if(cli){
 const [stepsFile,logsFile,artifactsFile,out='outputs/wage-renewal-v2-jobs']=process.argv.slice(2);
 assert.ok(stepsFile&&logsFile,'Usage: <steps.json> <logs.json> [artifacts.json] [outDir]');
 const packets=buildPackets(JSON.parse(readFileSync(stepsFile,'utf8')),JSON.parse(readFileSync(logsFile,'utf8')),
  artifactsFile&&artifactsFile!=='-'?JSON.parse(readFileSync(artifactsFile,'utf8')):{});
 mkdirSync(out,{recursive:true});
 assert.equal(readdirSync(out).filter(f=>f.endsWith('.json')).length,0,'Output directory must start empty');
 for(const p of packets)writeFileSync(out+'/'+p.jobId+'.json',JSON.stringify(p,null,1)+'\n');
 console.log(JSON.stringify({packets:packets.length,out,credits:0}));
}
