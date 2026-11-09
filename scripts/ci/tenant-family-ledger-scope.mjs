/** Scheduling only. Ambiguity runs the unchanged HTTP proof; never awards credit. */
import assert from 'node:assert/strict';
import {readFileSync,appendFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
export const MANIFEST='scripts/qa/tenant-isolation-coverage-manifest.json';
export const INVENTORY='tests/tenant-isolation-coverage-inventory.test.mjs';
export const DOCS=['docs/engineering/tenant-isolation-coverage-inventory.md','docs/engineering/tenant-isolation-closure-plan.md'];
const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
export function metadataOnly(event){
  const keys=Object.keys(event?.changes??{});
  return event?.action==='edited'&&sha(event.pull_request?.head?.sha)&&sha(event.pull_request?.base?.sha)&&
    keys.length>0&&keys.every(k=>['title','body'].includes(k))&&keys.every(k=>Object.hasOwn(event.changes[k]??{},'from'));
}
export function reusableEvent(event){
 return metadataOnly(event)||(event?.action==='ready_for_review'&&sha(event.pull_request?.head?.sha)&&sha(event.pull_request?.base?.sha)&&Object.keys(event.changes??{}).length===0);
}
function ledger(source){
 const doc=JSON.parse(source),rows=new Map(),counts={COVERED:0,GAP:0,'PUBLIC-BY-DESIGN':0};
 assert.ok(doc.allApiRouteFiles&&doc.metrics&&typeof doc.acceptanceStatus==='string');
 for(const [path,entry] of Object.entries(doc.allApiRouteFiles)){
   assert.ok(path.startsWith('src/app/api/')&&path.endsWith('/route.ts'));assert.ok(Array.isArray(entry.methods)&&entry.methods.length);
   for(const m of entry.methods){assert.ok(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(m.name));assert.ok(Object.hasOwn(counts,m.status));
     const key=m.name+' '+path.slice('src/app/api/'.length,-'/route.ts'.length);assert.ok(!rows.has(key));rows.set(key,m);counts[m.status]++;
   }
 }
 assert.equal(doc.metrics.methods,rows.size);assert.equal(doc.metrics.coveredAfter,counts.COVERED);assert.equal(doc.metrics.gap,counts.GAP);
 assert.equal(doc.metrics.publicByDesign,counts['PUBLIC-BY-DESIGN']);
 assert.ok(doc.acceptanceStatus.startsWith('NOT ACCEPTED: '+counts.GAP+' API methods'));
 return {doc,rows};
}
export function unrelatedLedger(before,after,owned){
 assert.ok(Array.isArray(owned)&&owned.length&&new Set(owned).size===owned.length);
 const a=ledger(before),b=ledger(after);assert.deepEqual([...a.rows.keys()].sort(),[...b.rows.keys()].sort(),'unknown method identity');
 assert.deepEqual(Object.keys(a.doc.allApiRouteFiles).sort(),Object.keys(b.doc.allApiRouteFiles).sort());
 for(const [key,m] of a.rows)if(m.status!=='GAP'&&b.rows.get(key).status!==m.status)return false;
 for(const key of owned){assert.ok(a.rows.has(key)&&b.rows.has(key),'unknown family method');if(JSON.stringify(a.rows.get(key))!==JSON.stringify(b.rows.get(key)))return false;}
 const neutral=({doc})=>{
   for(const [path,entry] of Object.entries(doc.allApiRouteFiles))entry.methods=entry.methods.map(m=>({name:m.name,foreign:owned.includes(m.name+' '+path.slice('src/app/api/'.length,-'/route.ts'.length))?m:'<OTHER_FAMILY>'}));
   doc.metrics.coveredAfter=0;doc.metrics.gap=0;doc.acceptanceStatus=doc.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/,'NOT ACCEPTED: <COUNT> API methods');
   return JSON.stringify(doc);
 };
 return neutral(a)===neutral(b);
}
export function familyProofRequired({eventName,event,changed,owned,manifestBefore,manifestAfter,inventoryBefore,inventoryAfter,verifiedPriorProof=false}){
 if(eventName!=='pull_request')return true;
 if(reusableEvent(event))return !verifiedPriorProof;
 if(!['opened','synchronize','reopened'].includes(event?.action))return true;
 if(!Array.isArray(changed)||!changed.length||!Array.isArray(owned)||!owned.length)return true;
 if(changed.some(f=>![MANIFEST,INVENTORY,...DOCS].includes(f)))return true;
 if(changed.includes(INVENTORY)){
   if(typeof inventoryBefore!=='string'||typeof inventoryAfter!=='string')return true;
   const neutral=s=>s.replace(/\b[a-f0-9]{40}\b/g,'<SHA>');
   if(neutral(inventoryBefore)!==neutral(inventoryAfter))return true;
 }
 if(!changed.includes(MANIFEST))return true;
 try{return !unrelatedLedger(manifestBefore,manifestAfter,owned);}catch{return true;}
}
export async function priorProofPassed({repo,workflow,event,entry,currentRunId,token,fetcher=fetch}){
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo??'')||!token||!reusableEvent(event))return false;
 const head=event.pull_request.head.sha,base=event.pull_request.base.sha,number=event.pull_request.number;
 if(!Number.isSafeInteger(number)||number<=0)return false;
 const get=async path=>{
  const url=new URL('https://api.github.com/repos/'+repo+path);
  // Validate the actual destination after parsing, and never follow a redirect
  // with the Actions token. Event/policy/response data may only select API paths.
  if(url.protocol!=='https:'||url.hostname!=='api.github.com'||url.port!==''||url.username!==''||url.password!==''||!url.pathname.startsWith('/repos/'+repo+'/actions/'))throw Error('Invalid Actions receipt destination');
  const r=await fetcher(url.href,{redirect:'error',headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(5000)});
  if(!r.ok)throw Error('Actions receipt unavailable');return r.json();
 };
 try{
  const result=await get('/actions/workflows/'+encodeURIComponent(workflow)+'/runs?event=pull_request&status=success&head_sha='+head+'&per_page=30');
  if(!Array.isArray(result.workflow_runs))return false;
  const candidates=result.workflow_runs.filter(r=>r.id!==Number(currentRunId)&&r.head_sha===head&&r.conclusion==='success'&&r.event==='pull_request'&&r.pull_requests?.some(p=>p.number===number&&p.base?.sha===base&&p.head?.sha===head)).slice(0,5);
  for(const run of candidates){
   if(!Number.isSafeInteger(run.id)||run.id<=0)continue;
   const result=await get('/actions/runs/'+run.id+'/jobs?filter=latest&per_page=100');
   if(!Array.isArray(result.jobs)||result.total_count!==result.jobs.length)continue;
   if(entry.proofJobs.every(name=>result.jobs.filter(j=>j.name===name&&j.head_sha===head&&j.status==='completed'&&j.conclusion==='success').length===1))return true;
  }
 }catch{return false;}return false;
}
export async function main(env=process.env){
 let run=true,reason='non-PR, unknown or relevant input';
 try{
   const policy=JSON.parse(readFileSync('.github/tenant-family-ledger-scope.json','utf8'));
   const entry=policy.workflows[env.TENANT_FAMILY_WORKFLOW];assert.ok(entry,'unknown workflow');
   if(env.GITHUB_EVENT_NAME==='pull_request'){
     const event=JSON.parse(readFileSync(env.GITHUB_EVENT_PATH,'utf8'));assert.ok(sha(event.pull_request?.base?.sha)&&sha(event.pull_request?.head?.sha));
     if(reusableEvent(event)){run=!(await priorProofPassed({repo:env.GITHUB_REPOSITORY,workflow:env.TENANT_FAMILY_WORKFLOW,event,entry,currentRunId:env.GITHUB_RUN_ID,token:env.GITHUB_TOKEN}));reason=run?'no successful exact-head/base proof receipt; run full proof':'metadata/readiness event with successful exact-head/base proof';}
     else{
       const base=event.pull_request.base.sha,git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:20*1024*1024});
       const changed=git('diff','--name-only','-z',base,'HEAD','--').split('\0').filter(Boolean);
       const args={eventName:env.GITHUB_EVENT_NAME,event,changed,owned:entry.methods};
       if(changed.includes(MANIFEST)){args.manifestBefore=git('show',base+':'+MANIFEST);args.manifestAfter=readFileSync(MANIFEST,'utf8');}
       if(changed.includes(INVENTORY)){args.inventoryBefore=git('show',base+':'+INVENTORY);args.inventoryAfter=readFileSync(INVENTORY,'utf8');}
       run=familyProofRequired(args);reason=run?'relevant or uncertain change':'unrelated family ledger-only change';
     }
   }
 }catch{run=true;reason='fail-closed: classifier input unavailable or invalid';}
 console.log(JSON.stringify({run,reason}));if(env.GITHUB_OUTPUT)appendFileSync(env.GITHUB_OUTPUT,'run='+run+'\n');return {run,reason};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
