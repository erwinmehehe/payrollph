import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { METHODS } from './tenant-self-development-contract.mjs';
export const RECEIPT='docs/qa/tenant-self-development-receipt.json';
export const SOURCES=['scripts/qa/tenant-self-development-contract.mjs','scripts/qa/tenant-self-development-http.mjs',
 '.github/workflows/tenant-ess-development-http.yml','src/app/api/self/performance/development-plans/route.ts'];
export const digest=file=>createHash('sha256').update(readFileSync(file,'utf8').replaceAll('\r\n','\n')).digest('hex');
export function verifyReceipt(r=JSON.parse(readFileSync(RECEIPT,'utf8'))) {
 assert.equal(r.schema,'self-development-local-http-v1');assert.deepEqual(r.methods,METHODS);
 assert.ok([16,18].includes(r.postgresMajor));assert.equal(Math.floor(r.serverVersionNum/10000),r.postgresMajor);
 assert.equal(r.productionTested,false);assert.equal(r.ci,'NOT_RUN');assert.equal(r.mutation.rejected,true);
 assert.match(r.mutation.message,/POST proof accepts another employer's data/);
 const run=r.run;assert.equal(run.kind,'self-development-tenant-http');assert.deepEqual(run.methods,METHODS);
 assert.equal(run.serverVersionNum,r.serverVersionNum);
 assert.deepEqual([run.ownReads,run.progressProofs,run.milestoneProofs,run.denied,run.discriminatingMethods],[2,4,4,48,3]);
 assert.equal(run.victimDatabaseUnchanged,true);assert.equal(run.coverageCredits,0);assert.equal(run.productionTested,false);assert.equal(run.certified,false);
 assert.deepEqual(r.sources.map(pin=>pin.file),SOURCES);
 for(const pin of r.sources)assert.equal(pin.sha256,digest(pin.file),'source drift requires renewed HTTP proof: '+pin.file);
 return r;
}
export function verifyCredits(manifest) {
 const file='scripts/qa/tenant-self-development-http.mjs';
 const credits=Object.values(manifest.allApiRouteFiles).flatMap(record=>record.methods
  .filter(method=>method.testedBy?.file===file).map(method=>({key:method.name+' '+record.route,method})));
 if(!credits.length)return 0;
 assert.deepEqual(credits.map(row=>row.key).sort(),[...METHODS].sort(),'only these three session-bound methods may cite this proof');
 const receipt=verifyReceipt(),lines=readFileSync(file,'utf8').split('\n');
 for(const {key,method} of credits) {
  const verb=key.split(' ')[0],p=method.testedBy;
  assert.equal(method.status,'COVERED');assert.equal(p.localReceipt,RECEIPT);assert.equal(p.postgresMajor,receipt.postgresMajor);
  assert.equal(p.evidence,receipt.runLabel);assert.equal(p.proofSha256,digest(file));assert.equal(p.line,p.ownPositiveLine);
  const own={GET:'const readBefore=await snapshot(actor.org.id), owned=status',POST:"const own=status(await request(ENDPOINT,{method:'POST'",PATCH:"const before=await snapshot(actor.org.id), own=status(await request(ENDPOINT,{method:'PATCH'"}[verb];
  assert.ok(lines[p.ownPositiveLine-1]?.includes(own));
  const foreign=verb==='GET'?"403,'revoked employee membership'":verb==='POST'?"await deny('POST',{planId:p.id":"await deny('PATCH',{milestoneId:p.milestone.id";
  assert.ok(lines[p.foreignDenialLine-1]?.includes(foreign));
  assert.ok(lines[p.unchangedDbLine-1]?.includes('assert.deepEqual(await snapshot(victim.org.id),victimBefore'));
  if(verb!=='GET')assert.ok(lines[p.forgedSelectorLine-1]?.includes(foreign));
 }
 return credits.length;
}
export function credit(args) {
 const allowed=['--self-development','--check'];assert.ok(args.every(arg=>allowed.includes(arg)),'self-development accepts only explicit batch and dry-run flags');
 const receipt=verifyReceipt(), file='scripts/qa/tenant-self-development-http.mjs', lines=readFileSync(file,'utf8').split('\n');
 const pin=fragment=>{const hits=lines.flatMap((line,index)=>line.includes(fragment)?[index+1]:[]);assert.equal(hits.length,1,'ambiguous proof pin '+fragment);return hits[0];};
 const positives={GET:pin("const readBefore=await snapshot(actor.org.id), owned=status"),POST:pin("const own=status(await request(ENDPOINT,{method:'POST'"),PATCH:pin("const before=await snapshot(actor.org.id), own=status(await request(ENDPOINT,{method:'PATCH'")};
 const manifestPath='scripts/qa/tenant-isolation-coverage-manifest.json',overviewPath='docs/engineering/tenant-isolation-coverage-inventory.md';
 const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));let overview=readFileSync(overviewPath,'utf8'),fresh=0;
 const record=Object.values(manifest.allApiRouteFiles).find(row=>row.route==='self/performance/development-plans');assert.ok(record);
 for(const key of METHODS) {
  const verb=key.split(' ')[0], method=record.methods.find(item=>item.name===verb);assert.ok(method);
  assert.ok(method.status==='GAP'||method.testedBy?.file===file,'refuse replacing independently reviewed provenance');
  if(method.status==='GAP')fresh++;
  method.status='COVERED';method.reason='Provisional: real two-employee-attacker localhost HTTP / disposable PostgreSQL '+receipt.postgresMajor+
   '; own nonempty identity-bound read or persisted progress/milestone change; actual foreign and peer IDs denied, private/closed evidence refused, revoked membership denied, and victim source rows/audit unchanged. Exact-head PG16 CI and reviewer acceptance pending; not production certification.';
  method.testedBy={file,line:positives[verb],ownPositiveLine:positives[verb],foreignDenialLine:pin(verb==='GET'?"403,'revoked employee membership'":verb==='POST'?"await deny('POST',{planId:p.id":"await deny('PATCH',{milestoneId:p.milestone.id"),
   unchangedDbLine:pin("assert.deepEqual(await snapshot(victim.org.id),victimBefore"),
   ...(verb==='GET'?{}:{forgedSelectorLine:pin(verb==='POST'?"await deny('POST',{planId:p.id":"await deny('PATCH',{milestoneId:p.milestone.id")}),
   scope:verb==='GET'?'Session-derived employee identity: populated own plans, skills, milestones and progress; query selectors cannot override cookie identity. Same-session membership revocation denies access; no fabricated foreign-organization GET denial.':
    'Both independently authenticated employees perform exact own persisted writes; foreign and peer plan/milestone IDs return 404, hidden evidence 404, closed evidence 409; numeric and null progress and in_progress/completed milestone transitions; unchanged victim/peer/payroll/audit.',
   postgresMajor:receipt.postgresMajor,localReceipt:RECEIPT,evidence:receipt.runLabel,proofSha256:digest(file)};
  const rows=overview.split('\n'),prefix='| [`'+record.route+'` '+verb+'](';const at=rows.findIndex(row=>row.startsWith(prefix));assert.ok(at>=0);
  const cells=rows[at].split(' | ');cells[cells.length-2]='[Executed self-development HTTP proof](../../'+file+'#L'+positives[verb]+') — [local receipt](../qa/tenant-self-development-receipt.json)';cells[cells.length-1]='**COVERED** |';rows[at]=cells.join(' | ');overview=rows.join('\n');
 }
 const all=Object.values(manifest.allApiRouteFiles).flatMap(row=>row.methods);
 manifest.metrics.coveredAfter=all.filter(row=>row.status==='COVERED').length;manifest.metrics.gap=all.filter(row=>row.status==='GAP').length;
 const gaps=manifest.metrics.gap;manifest.acceptanceStatus=manifest.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/,'NOT ACCEPTED: '+gaps+' API methods');
 if(fresh)manifest.acceptanceStatus+=' Self-development adds '+fresh+' source-bound provisional local HTTP method credits; exact-head PG16 CI and review pending.';
 overview=overview.replace(/\*\*RELEASE BLOCKER:\*\* \d+ API methods/,'**RELEASE BLOCKER:** '+gaps+' API methods').replace(/\*\*NOT ACCEPTED\*\*: \d+ method gaps/,'**NOT ACCEPTED**: '+gaps+' method gaps');
 for(const key of ['coveredAfter','gap'])overview=overview.replace(new RegExp('^\\| '+key+' \\| \\d+ \\|$','m'),'| '+key+' | '+manifest.metrics[key]+' |');
 verifyCredits(manifest);
 if(!args.includes('--check')){writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');writeFileSync(overviewPath,overview);}
 console.log(JSON.stringify({newlyCredited:fresh,covered:manifest.metrics.coveredAfter,gap:gaps,write:!args.includes('--check')}));
}
