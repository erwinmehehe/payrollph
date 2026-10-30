import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {METHODS,ACTIONS} from './tenant-performance-core-contract.mjs';
export const RECEIPT='docs/qa/tenant-performance-core-receipt.json';
export const PROOF='scripts/qa/tenant-performance-core-http.mjs';
export const SOURCES=Object.freeze([PROOF,'scripts/qa/tenant-performance-core-contract.mjs',
 'scripts/qa/tenant-performance-core-credit.mjs','.github/workflows/tenant-table-proof.yml',
 'scripts/qa/tenant-table-http.mjs','scripts/qa/tenant-table-invariants.mjs',
 'src/app/api/performance/route.ts','src/app/api/performance/calibration/route.ts',
 'src/app/api/performance/follow-through-governance/route.ts']);
export const digest=file=>createHash('sha256').update(readFileSync(file,'utf8').replaceAll('\r\n','\n')).digest('hex');
const pin=fragment=>{const lines=readFileSync(PROOF,'utf8').split('\n');const hits=lines.flatMap((line,i)=>line.includes(fragment)?[i+1]:[]);assert.equal(hits.length,1,'ambiguous proof anchor '+fragment);return hits[0];};
export function verifyReceipt(receipt=JSON.parse(readFileSync(RECEIPT,'utf8'))) {
 assert.equal(receipt.schema,'performance-core-local-pg16-receipt-v1');
 assert.equal(receipt.postgresMajor,16);assert.equal(receipt.productionTested,false);assert.equal(receipt.ci,'NOT_RUN');
 assert.equal(receipt.mutation.rejected,true);assert.match(receipt.mutation.message,/proof accepts another employer's data/);
 assert.ok(typeof receipt.runLabel==='string'&&receipt.runLabel.length>30);
 assert.deepEqual(receipt.sources.map(p=>p.file),SOURCES);
 for(const p of receipt.sources)assert.equal(p.sha256,digest(p.file),'renew executed source evidence: '+p.file);
 const r=receipt.run;assert.equal(r.kind,'performance-core-http-v1');assert.deepEqual(r.methods,METHODS);
 assert.equal(Math.floor(r.serverVersionNum/10000),16);assert.deepEqual([r.own,r.denied,r.forged,r.discriminating],[54,54,56,27]);
 assert.equal(r.victimDatabaseUnchanged,true);assert.equal(r.coverageCredits,0);assert.equal(r.productionTested,false);assert.equal(r.certified,false);
 assert.equal(r.actions.length,54);
 for(const key of METHODS)for(const attacker of ['ATTA','ATTB']) {
   const rows=r.actions.filter(a=>a.key===key&&a.attacker===attacker);
   assert.deepEqual(rows.map(a=>a.label),ACTIONS[key]);
   for(const a of rows){assert.equal(a.own,key.startsWith('POST')?201:200);assert.equal(a.foreign,403);assert.equal(a.discrimination,attacker==='ATTB');}
 }
 return receipt;
}
export function verifyCredit(key,method) {
 assert.ok(METHODS.includes(key));const r=verifyReceipt(),p=method.testedBy;
 assert.equal(method.status,'COVERED');assert.equal(p.file,PROOF);assert.equal(p.localReceipt,RECEIPT);
 assert.equal(p.evidence,r.runLabel);assert.equal(p.proofSha256,digest(PROOF));
 assert.equal(p.ownPositiveLine,pin('const owned=status(await request'));
 assert.equal(p.line,p.ownPositiveLine);assert.equal(p.foreignDenialLine,pin('const denied=status(await request'));
 assert.equal(p.forgedSelectorLine,pin('const refusal=await request'));
 assert.equal(p.unchangedDbLine,pin("'every action leaves victim business rows/audit unchanged'"));
 assert.deepEqual(p.actions,ACTIONS[key]);return true;
}
export function verifyCredits(manifest) {
 const credited=Object.values(manifest.allApiRouteFiles).flatMap(record=>record.methods
   .filter(method=>method.testedBy?.file===PROOF).map(method=>({key:method.name+' '+record.route,method})));
 if(!credited.length)return 0;
 assert.deepEqual(credited.map(r=>r.key).sort(),[...METHODS].sort(),'only the four completed methods may cite this receipt');
 for(const {key,method} of credited)verifyCredit(key,method);
 return credited.length;
}
export function credit(args) {
 const labelAt=args.indexOf('--run-label');assert.ok(labelAt>=0,'executed run label required');
 const allowed=args.filter((_,i)=>i!==labelAt&&i!==labelAt+1);assert.ok(allowed.every(a=>['--performance-core','--check'].includes(a)));
 const receipt=verifyReceipt();assert.equal(args[labelAt+1],receipt.runLabel);
 const file='scripts/qa/tenant-isolation-coverage-manifest.json',overviewFile='docs/engineering/tenant-isolation-coverage-inventory.md';
 const manifest=JSON.parse(readFileSync(file,'utf8'));let overview=readFileSync(overviewFile,'utf8'),fresh=0;
 for(const key of METHODS){
   const [verb,route]=key.split(' '),path='src/app/api/'+route+'/route.ts',record=manifest.allApiRouteFiles[path];assert.ok(record);
   const method=record.methods.find(m=>m.name===verb);assert.ok(method);
   assert.ok(method.status==='GAP'||method.testedBy?.file===PROOF,'do not replace another proof');
   if(method.status==='GAP')fresh++;
   method.status='COVERED';method.reason='Provisional complete-action fictional PG16/localhost HTTP: two attackers, own persisted DB/audit effects, real victim and forged resource denials, per-action proof discrimination and unchanged victim rows. Exact-head CI/reviewer acceptance pending; no production certification.';
   method.testedBy={file:PROOF,line:pin('const owned=status(await request'),ownPositiveLine:pin('const owned=status(await request'),
     foreignDenialLine:pin('const denied=status(await request'),forgedSelectorLine:pin('const refusal=await request'),
     unchangedDbLine:pin("'every action leaves victim business rows/audit unchanged'"),
     actions:ACTIONS[key],postgresMajor:16,localReceipt:RECEIPT,evidence:receipt.runLabel,proofSha256:digest(PROOF)};
   const source=readFileSync(path,'utf8').replaceAll('\r\n','\n');
   record.gitBlobSha=createHash('sha1').update('blob '+Buffer.byteLength(source)+'\0').update(source).digest('hex');
   for(const m of record.methods){const found=source.split('\n').findIndex(line=>line.includes('export async function '+m.name+'('));assert.ok(found>=0);m.line=found+1;}
   const rows=overview.split('\n'),prefix='| [`'+route+'` '+verb+'](';const at=rows.findIndex(row=>row.startsWith(prefix));assert.ok(at>=0);
   const cells=rows[at].split(' | ');cells[cells.length-2]='[Complete-action PG16 HTTP](../../'+PROOF+'#L'+method.testedBy.line+') — [receipt](../qa/tenant-performance-core-receipt.json)';cells[cells.length-1]='**COVERED** |';rows[at]=cells.join(' | ');overview=rows.join('\n');
   verifyCredit(key,method);
 }
 const all=Object.values(manifest.allApiRouteFiles).flatMap(r=>r.methods);manifest.metrics.coveredAfter=all.filter(m=>m.status==='COVERED').length;manifest.metrics.gap=all.filter(m=>m.status==='GAP').length;
 manifest.acceptanceStatus=manifest.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/,'NOT ACCEPTED: '+manifest.metrics.gap+' API methods');
 if(fresh)manifest.acceptanceStatus+=' Performance core adds exactly '+fresh+' provisional complete-action local PG16 HTTP credits; final-head CI and review remain required.';
 overview=overview.replace(/\*\*RELEASE BLOCKER:\*\* \d+ API methods/,'**RELEASE BLOCKER:** '+manifest.metrics.gap+' API methods').replace(/\*\*NOT ACCEPTED\*\*: \d+ method gaps/,'**NOT ACCEPTED**: '+manifest.metrics.gap+' method gaps');
 for(const key of ['coveredAfter','gap'])overview=overview.replace(new RegExp('^\\| '+key+' \\| \\d+ \\|$','m'),'| '+key+' | '+manifest.metrics[key]+' |');
 if(!args.includes('--check')){writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');writeFileSync(overviewFile,overview);}
 console.log(JSON.stringify({newlyCredited:fresh,covered:manifest.metrics.coveredAfter,gap:manifest.metrics.gap,write:!args.includes('--check')}));
}
