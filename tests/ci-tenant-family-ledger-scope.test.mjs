import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {load} from 'js-yaml';
import {familyProofRequired,metadataOnly,reusableEvent,priorProofPassed,MANIFEST,INVENTORY,DOCS} from '../scripts/ci/tenant-family-ledger-scope.mjs';
const policy=JSON.parse(readFileSync('.github/tenant-family-ledger-scope.json','utf8'));
const REVIEWED_EXECUTION={
 'tenant-dl01-closure.yml':'b8d40fff76995444ebe1df403ad2832603d47de90b1f57a30564d089efa222ba',
 'tenant-ess-documents-read.yml':'77c659179b1dcaa4f84c031d6107444b685480fe19a211802ba9dfe09c8b5e03',
};
const event={action:'synchronize',pull_request:{number:123,head:{sha:'a'.repeat(40)},base:{sha:'b'.repeat(40)}}};
const sample=()=>recount({metrics:{},allApiRouteFiles:{
 'src/app/api/documents/route.ts':{gitBlobSha:'d'.repeat(40),route:'documents',methods:[{name:'POST',status:'GAP',testedBy:null}]},
 'src/app/api/careers/route.ts':{gitBlobSha:'c'.repeat(40),route:'careers',methods:[{name:'POST',status:'GAP',testedBy:null}]}}});
const recount=m=>{const methods=Object.values(m.allApiRouteFiles).flatMap(x=>x.methods);m.metrics.methods=methods.length;m.metrics.coveredAfter=methods.filter(x=>x.status==='COVERED').length;m.metrics.gap=methods.filter(x=>x.status==='GAP').length;m.metrics.publicByDesign=methods.filter(x=>x.status==='PUBLIC-BY-DESIGN').length;m.acceptanceStatus='NOT ACCEPTED: '+m.metrics.gap+' API methods remain';return m;};
const args=()=>{const before=sample(),after=sample();Object.assign(after.allApiRouteFiles['src/app/api/careers/route.ts'].methods[0],{status:'COVERED',testedBy:{file:'fictional-proof.mjs'}});recount(after);return {eventName:'pull_request',event,changed:[MANIFEST,...DOCS],owned:['POST documents'],manifestBefore:JSON.stringify(before),manifestAfter:JSON.stringify(after)};};
test('a distinct family credit plus derived counts/docs can skip, but own method cannot',()=>{
 assert.equal(familyProofRequired(args()),false);
 assert.equal(familyProofRequired({...args(),owned:['POST careers']}),true);
 const a=args();a.changed.push(INVENTORY);a.inventoryBefore='const sha="'+'a'.repeat(40)+'";';a.inventoryAfter='const sha="'+'b'.repeat(40)+'";';assert.equal(familyProofRequired(a),false);
 a.inventoryAfter='assert.ok(false)';assert.equal(familyProofRequired(a),true);
});
test('runtime, scripts, tests, workflows, unknown files and source pins always force full proof',()=>{
 for(const file of ['src/lib/auth.ts','src/app/api/careers/route.ts','src/db/schema.ts','scripts/qa/foreign-credit.mjs','tests/foreign.test.mjs','.github/workflows/another.yml','package-lock.json','drizzle/fixture.sql','unknown.txt'])assert.equal(familyProofRequired({...args(),changed:[MANIFEST,file]}),true,file);
 for(const mutate of [m=>m.allApiRouteFiles['src/app/api/careers/route.ts'].gitBlobSha='e'.repeat(40),m=>m.ownerAccepted=true,m=>m.metrics.methods++,m=>m.acceptanceStatus='ACCEPTED',m=>delete m.allApiRouteFiles['src/app/api/documents/route.ts'],m=>m.allApiRouteFiles['src/app/api/documents/route.ts'].methods[0].status='PUBLIC-BY-DESIGN']){
  const a=args(),m=JSON.parse(a.manifestAfter);mutate(m);a.manifestAfter=JSON.stringify(m);assert.equal(familyProofRequired(a),true);
 }
 for(const patch of [{changed:[]},{changed:DOCS},{eventName:'workflow_dispatch'},{manifestAfter:'bad JSON'},{owned:[]},{owned:['POST nonexistent']}])assert.equal(familyProofRequired({...args(),...patch}),true);
});
test('own proof metadata and foreign downgrades cannot skip',()=>{
 const a=args(),m=JSON.parse(a.manifestAfter);m.allApiRouteFiles['src/app/api/documents/route.ts'].methods[0].reviewedUncertified={proofBlobSha:'a'.repeat(40)};a.manifestAfter=JSON.stringify(m);assert.equal(familyProofRequired(a),true);
 const b=args();[b.manifestBefore,b.manifestAfter]=[b.manifestAfter,b.manifestBefore];assert.equal(familyProofRequired(b),true);
});
test('only verified title/body edits skip; base, missing revisions and unknown edits run',()=>{
 const body={...event,action:'edited',changes:{body:{from:'old'}}};assert.equal(metadataOnly(body),true);
 assert.equal(familyProofRequired({eventName:'pull_request',event:body}),true,'Without a green prior proof metadata edits cannot manufacture a skip');
 assert.equal(familyProofRequired({eventName:'pull_request',event:body,verifiedPriorProof:true}),false);
 for(const patch of [{changes:{}},{changes:{base:{ref:{from:'old'}}}},{changes:{body:{from:'old'},base:{ref:{from:'old'}}}},{changes:{unknown:{from:'old'}}},{changes:{title:{}}},{pull_request:{}}])assert.equal(metadataOnly({...body,...patch}),false);
 assert.equal(familyProofRequired({eventName:'pull_request',event:{...body,changes:{base:{}}}}),true);
 assert.equal(familyProofRequired({...args(),event:{...event,action:'edited',changes:{base:{ref:{from:'old'}}}}}),true,'Base retargeting must run even when the current diff looks like a foreign ledger credit');
 assert.equal(familyProofRequired({...args(),event:{...event,action:'unknown'}}),true);
 const ready={...event,action:'ready_for_review'};assert.equal(reusableEvent(ready),true);
 assert.equal(familyProofRequired({eventName:'pull_request',event:ready}),true);
 assert.equal(familyProofRequired({eventName:'pull_request',event:ready,verifiedPriorProof:true}),false);
 assert.equal(reusableEvent({...ready,changes:{base:{from:'old'}}}),false);
});
test('metadata reuse needs every real matrix job on the exact head AND base, never skipped jobs',async()=>{
 const e={...event,action:'edited',changes:{body:{from:'old'}}},head=event.pull_request.head.sha,base=event.pull_request.base.sha;
 const entry={proofJobs:['table (default)','table (flagged-reads)']};
 const run={id:51,event:'pull_request',head_sha:head,conclusion:'success',pull_requests:[{number:123,head:{sha:head},base:{sha:base}}]};
 const jobs=entry.proofJobs.map(name=>({name,head_sha:head,status:'completed',conclusion:'success'}));
 const check=async(r=run,j=jobs,patch={})=>{
  let calls=0;const fetcher=async(url,options)=>{calls++;const destination=new URL(url);assert.equal(destination.origin,'https://api.github.com');assert.ok(destination.pathname.startsWith('/repos/fictional/repo/actions/'));assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer fictional-token');return {ok:true,json:async()=>calls===1?{workflow_runs:[r]}:{total_count:j.length,jobs:j}};};
  return priorProofPassed({repo:'fictional/repo',workflow:'tenant-table-proof.yml',event:e,entry,currentRunId:'99',token:'fictional-token',fetcher,...patch});
 };
 assert.equal(await check(),true);
 for(const patch of [{id:99},{head_sha:'c'.repeat(40)},{event:'workflow_dispatch'},{conclusion:'failure'},{pull_requests:[]},{pull_requests:[{number:123,head:{sha:head},base:{sha:'c'.repeat(40)}}]}])assert.equal(await check({...run,...patch}),false);
 for(const patch of [{conclusion:'skipped'},{conclusion:'failure'},{status:'in_progress'},{head_sha:'c'.repeat(40)}])assert.equal(await check(run,[{...jobs[0],...patch},jobs[1]]),false);
 assert.equal(await check(run,[jobs[0]]),false);assert.equal(await check(run,[...jobs,jobs[0]]),false);
 assert.equal(await check(run,jobs,{token:''}),false);
 for(const repo of ['evil.example/path?x=', '//evil.example', 'fictional/repo/../../outside', 'fictional/repo#fragment'])assert.equal(await check(run,jobs,{repo,fetcher:async()=>{assert.fail('invalid repository must not receive a token');}}),false);
 assert.equal(await check(run,jobs,{workflow:'https://evil.example/../receipt?x=#fragment'}),true,'workflow data stays encoded in the fixed GitHub API path');
 assert.equal(await check(run,jobs,{fetcher:async()=>{throw Error('unavailable');}}),false);
 assert.equal(await check(run,jobs,{fetcher:async()=>({ok:false})}),false);
 assert.equal(await check(run,jobs,{fetcher:async()=>({ok:true,json:async()=>({workflow_runs:[run],total_count:101,jobs})})}),false);
});
test('both eligible execution jobs exactly match explicit source-pinned approval snapshots',()=>{
 assert.equal(Object.keys(policy.workflows).length,2);
 assert.equal(policy.comparisonBase,'8d64ff4ee04d394b82060da80e3a3580cc84743b');
 assert.equal(policy.workflows['tenant-dl01-closure.yml'].previousExecutionSha256,'b18c9ce9c1e55cfc6c777977e6577b400aa4821606a754e3b681eebf2401fee1',
   'Retain the pre-fix DL-01 execution fingerprint as provenance; no silent baseline replacement');
 assert.equal(policy.workflows['tenant-dl01-closure.yml'].executionRevisionScope,
   'CI-only restricted UID sudo env -i explicit synthetic proof variable allowlist; unchanged three-employer verification, kernel egress, PG16, provider stubs and full regression; independent review pending');
 const dl01=readFileSync('.github/workflows/tenant-dl01-closure.yml','utf8');
 for(const s of ['proof_keys=(', 'sudo -u dl01proof -- env -i', 'proof_env+=("$key=${!key}")',
   'sudo iptables -I OUTPUT 1 -m owner', 'sudo ip6tables -I OUTPUT 1 -m owner',
   'proof timeout --signal=TERM --kill-after=10s 300s',
   'Full repository Node test suite against the separate throwaway app_db'])
   assert.ok(dl01.includes(s),'The only approved SHA refresh cannot remove DL-01 invariant: '+s);
 for(const forbidden of ['sudo -E -u dl01proof','GITHUB_TOKEN GH_TOKEN','NEON_DATABASE_URL PRODUCTION_DATABASE_URL'])
   assert.ok(!dl01.includes(forbidden),'Do not broaden restricted proof environment: '+forbidden);
 assert.deepEqual(Object.fromEntries(Object.entries(policy.workflows).map(([file,p])=>[file,p.executionSha256])),REVIEWED_EXECUTION,'Original execution snapshots require explicit review, never blind repinning');
 for(const [file,p] of Object.entries(policy.workflows)){
  const w=load(readFileSync('.github/workflows/'+file,'utf8')),job=w.jobs[p.job];
  const execution=Object.fromEntries(Object.entries(job).filter(([k])=>!['if','needs'].includes(k)));
  assert.equal(createHash('sha256').update(JSON.stringify(execution)).digest('hex'),p.executionSha256,file+': no HTTP step, matrix, environment, database or assertion may change');
  assert.equal(job.needs,'family-scope');assert.ok(job.if.includes("needs.family-scope.result != 'success'"));assert.ok(job.if.includes("needs.family-scope.outputs.run != 'false'"));assert.ok(job.if.includes(p.originalIf.slice(3,-2).trim()));assert.ok(job.if.includes('!cancelled()'));
  const group=w.concurrency.group;assert.ok(group.includes("(github.event.action == 'ready_for_review' || github.event.action == 'edited' && !github.event.changes.base) && 'metadata' || 'proof'"),'metadata/readiness cannot cancel an active proof');assert.ok(group.includes('github.event_name'));assert.ok(group.includes('github.workflow'));
  const scope=w.jobs['family-scope'];assert.equal(scope.outputs.run,'${{ steps.scope.outputs.run }}');assert.match(scope.steps[0].uses,/actions\/checkout@[a-f0-9]{40}$/);assert.equal(scope.steps[0].with['persist-credentials'],false);assert.ok(scope.steps.every(s=>!s.run?.includes('npm ci')));
  assert.deepEqual(scope.permissions,{contents:'read',actions:'read'});assert.equal(scope.steps.at(-1).env.GITHUB_TOKEN,'${{ github.token }}');
  for(const path of ['scripts/ci/tenant-family-ledger-scope.mjs','.github/tenant-family-ledger-scope.json','tests/ci-tenant-family-ledger-scope.test.mjs'])assert.ok(w.on.pull_request.paths.includes(path));
 }
 for(const [file,methods] of [['tenant-dl01-closure.yml',['GET year-end/prior-evidence','POST year-end/prior-evidence','POST payroll-runs/[id]/exports','POST documents','POST employees/import']],['tenant-ess-documents-read.yml',['GET self/documents']]])assert.deepEqual(policy.workflows[file].methods,methods.sort());
 assert.equal(policy.workflows['tenant-table-proof.yml'],undefined,'Keep the byte-pinned performance-core workflow unchanged until a fresh reproof');
 assert.equal(policy.workflows['tenant-dl02-closure.yml'],undefined,'Keep byte-pinned DL-02 credits unchanged');
});
test('CLI fails closed on missing event, policy, Git history and unknown workflow',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ci-family-scope-'));try{
  const output=join(dir,'out'),evt=join(dir,'event.json');writeFileSync(evt,JSON.stringify(event));
  for(const patch of [{TENANT_FAMILY_WORKFLOW:'unknown'},{GITHUB_EVENT_PATH:join(dir,'missing')},{GITHUB_EVENT_PATH:evt}]){
   writeFileSync(output,'');const r=spawnSync(process.execPath,['scripts/ci/tenant-family-ledger-scope.mjs'],{encoding:'utf8',env:{...process.env,GITHUB_EVENT_NAME:'pull_request',GITHUB_EVENT_PATH:evt,TENANT_FAMILY_WORKFLOW:'tenant-dl01-closure.yml',GITHUB_OUTPUT:output,...patch}});
   assert.equal(r.status,0,r.stderr);assert.match(readFileSync(output,'utf8'),/^run=true\n$/);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
