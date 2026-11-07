import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const FILE='scripts/qa/tenant-spend-managed-receipt.json';
export const TARGETS=['POST spend','PATCH spend','POST managed-payroll/runs/[id]/approve'];
const blob=raw=>{const b=Buffer.from(raw.toString().replaceAll('\r\n','\n'));return createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');};
const RECEIPT_DIGEST='527fd8d85642abf58ea7a3527e87ea778a02f5e91fe1e2ce13df2bcce18a482f';
export function verifySpendManaged(manifest,reader=readFileSync){
 const raw=reader(FILE).toString().replaceAll('\r\n','\n');
 assert.equal(createHash('sha256').update(raw).digest('hex'),RECEIPT_DIGEST,'immutable reviewed receipt');
 const r=JSON.parse(raw);
 assert.equal(r.head,'f286d177ebc5acb304fd743d5df31a421471bcd4');
 assert.equal(r.run,42425680713); assert.equal(r.job,128563327706);
 assert.deepEqual(Object.keys(r.methods),TARGETS);
 for(const [file,pin] of Object.entries(r.pins)){
  assert.ok(!file.includes('..')&&!file.startsWith('/'),'repository source only');
  assert.equal(blob(reader(file)),pin,file+': executed source drift');
 }
 for(const key of TARGETS){const [verb,...parts]=key.split(' '),path='src/app/api/'+parts.join(' ')+'/route.ts';
  const method=manifest.allApiRouteFiles[path].methods.find(m=>m.name===verb);
  assert.equal(method.status,'COVERED');assert.deepEqual(method.testedBy,r.methods[key]);
  assert.equal(method.testedBy.evidenceLabel,'SOLO_VERIFIED_DEV_RECOVERY');
  assert.equal(manifest.allApiRouteFiles[path].gitBlobSha,r.pins[path]);
 }
 return 3;
}
if(process.argv.includes('--generate')){
 const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:20000000}).trim();
 const head='f286d177ebc5acb304fd743d5df31a421471bcd4';
 execFileSync('git',['merge-base','--is-ancestor','bfbeaca7cc5f258773241cd35653a029546034f3','HEAD']);
 // Bind every application source, locked dependency/configuration and all
 // existing QA fixture modules, not only the three handler files.
 const files=git('ls-tree','-r','--name-only',head,'src','scripts/qa').split('\n').filter(p=>p.startsWith('src/')||/\.(mjs|ts|cjs)$/.test(p));
 files.push('package.json','package-lock.json','next.config.ts','tsconfig.json','.github/workflows/tenant-spend-write-actions-http.yml');
 const tree=new Map(git('ls-tree','-r',head).split('\n').map(line=>{const [meta,file]=line.split('\t');return [file,meta.split(' ')[2]];}));
 const pins={};for(const file of files){
  assert.equal(blob(readFileSync(file)),tree.get(file),file+': source changed since successful proof');pins[file]=tree.get(file);}
 const path='scripts/qa/tenant-isolation-coverage-manifest.json',m=JSON.parse(readFileSync(path,'utf8'));
 const before={covered:m.metrics.coveredAfter,gap:m.metrics.gap};const methods={};
 for(const key of TARGETS){const [verb,route]=key.split(' '),file='src/app/api/'+route+'/route.ts';
  const method=m.allApiRouteFiles[file].methods.find(x=>x.name===verb);assert.equal(method.status,'GAP');
  const harness=route==='spend'?'scripts/qa/tenant-spend-write-actions-http.mjs':'scripts/qa/tenant-managed-client-approval-http.mjs';
  const lines=readFileSync(harness,'utf8').split('\n');const cite=text=>{const i=lines.findIndex(l=>l.includes(text));assert.ok(i>=0,text);return i+1;};
  const own=cite(route==='spend'?(verb==='POST'?'const card = good(await request':'const approve = good(await request'):'const own = await post(f, f.run.id');
  const foreign=cite(route==='spend'?'403, "foreign category review"':'const foreign = await post(f, victim.run.id');
  const unchanged=cite(route==='spend'?'assert.deepEqual(await state(victim.actor.org.id), beforeVictim':'assert.deepEqual(await snapshot(victim), victimBefore);');
  method.status='COVERED';delete method.reviewedUncertified;
  method.reason='Provisional SOLO_VERIFIED_DEV_RECOVERY: dedicated required-OFF PG16 real HTTP proof; own persisted success, two attackers, real victim and forged-selector denial, unchanged victim SQL. No production acceptance.';
  method.testedBy={file:harness,line:own,ownPositiveLine:own,foreignDenialLine:foreign,unchangedDbLine:unchanged,evidenceLabel:'SOLO_VERIFIED_DEV_RECOVERY',workflowRunId:42425680713,workflowJobId:128563327706,verifiedPrHeadSha:head,proofPullRequest:1829,evidence:'https://github.com/erwinmehehe/payrollph/actions/runs/42425680713/job/128563327706',scope:method.reason,productionTested:false};methods[key]=method.testedBy;
 }
 const all=Object.values(m.allApiRouteFiles).flatMap(r=>r.methods);m.metrics.coveredAfter=all.filter(x=>x.status==='COVERED').length;m.metrics.gap=all.filter(x=>x.status==='GAP').length;
 m.acceptanceStatus=m.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/,'NOT ACCEPTED: '+m.metrics.gap+' API methods');
 writeFileSync(FILE,JSON.stringify({head,run:42425680713,job:128563327706,pins,methods},null,2)+'\n');
 writeFileSync(path,JSON.stringify(m,null,2)+'\n');console.log(JSON.stringify({before,after:{covered:m.metrics.coveredAfter,gap:m.metrics.gap}}));
}
