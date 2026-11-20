import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {readWageRenewalInventory} from '../scripts/qa/wage-registry-renewal-plan.mjs';
import {methodKey} from '../scripts/qa/wage-registry-renewal-methods.mjs';
import {ACCOUNTING_ONLY,wageRenewalHoldView} from '../scripts/qa/wage-registry-renewal-verify.mjs';
import {V2_ACCOUNTING_ONLY,V2_GLOBAL_ROOTS,WAGE_RENEWAL_V2_KIND,WAGE_RENEWAL_V2_SCHEMA,WAGE_RENEWAL_V2_RECEIPT_BLOB,
 wageRenewalV2Drift,validateWageRenewalV2Closures,wageRenewalV2HoldView,verifyWageRenewalV2Rows} from '../scripts/qa/wage-registry-renewal-v2.mjs';
import {closure,fileEdges,sealClosures,isLedgerSource} from '../scripts/qa/wage-registry-renewal-v2-capture.mjs';
import {extractLogRecords,jobIdentityByName,buildPackets} from '../scripts/qa/wage-registry-renewal-packets.mjs';

const sha=text=>{const b=Buffer.from(text);return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');};
const repo=files=>({read:f=>{if(!Object.hasOwn(files,f)){const e=new Error('ENOENT '+f);e.code='ENOENT';throw e;}return Buffer.from(files[f]);},exists:f=>Object.hasOwn(files,f)});

test('v2 accounting scope is the v1 scope, three ledger reconcilers and the three v2 bookkeeping files, nothing that makes a request',()=>{
 assert.deepEqual(V2_ACCOUNTING_ONLY.slice(0,ACCOUNTING_ONLY.length),[...ACCOUNTING_ONLY]);
 assert.deepEqual(V2_ACCOUNTING_ONLY.slice(ACCOUNTING_ONLY.length),[
  'scripts/qa/payroll-run-credit-renewal.mjs','scripts/qa/payroll-run-sso-proof-fixture.mjs','scripts/qa/wage-registry-renewal-supersession.mjs',
  'scripts/qa/wage-registry-renewal-v2.mjs','scripts/qa/wage-registry-renewal-v2-capture.mjs','scripts/qa/wage-registry-renewal-packets.mjs']);
 for(const f of V2_GLOBAL_ROOTS)assert.ok(!V2_ACCOUNTING_ONLY.includes(f));
 // Bookkeeping validates the ledger; it must never be where an HTTP proof or a database write happens.
 for(const f of V2_ACCOUNTING_ONLY){
  // The generator names these calls in its own detection pattern and only runs `git ls-tree`.
  if(f==='scripts/qa/wage-registry-renewal-v2-capture.mjs')continue;
  const source=readFileSync(f,'utf8');
  assert.doesNotMatch(source,/\bfetch\(|\bpg\b|new Pool\(|from ['"]postgres['"]|INSERT INTO|UPDATE [a-z_]+ SET/i,f+' must stay bookkeeping only');
 }
});

test('closure follows runtime imports, skips erased type-only imports, follows launched scripts and fixtures',()=>{
 const {read,exists}=repo({
  'src/a.ts':'import {x} from "./b";\nimport type {T} from "./typesonly";\nimport {type U} from "./alsotypes";\nexport type {V} from "./reexported";\nconst d=await import("@/c");',
  'src/b.ts':'export const x=1;','src/c.ts':'export {};','src/typesonly.ts':'export type T=1;','src/alsotypes.ts':'export type U=1;','src/reexported.ts':'export type V=1;',
  'scripts/run.mjs':'import {spawnSync} from "node:child_process";\nspawnSync(process.execPath,["scripts/child.mjs"]);\nconst f="fixtures/qa/key.pem";',
  'scripts/child.mjs':'export {};','fixtures/qa/key.pem':'pem',
  'scripts/mentions.mjs':'const elsewhere="scripts/child.mjs";',
 });
 assert.deepEqual(Object.keys(closure(['src/a.ts'],read,exists)),['src/a.ts','src/b.ts','src/c.ts']);
 assert.deepEqual(Object.keys(closure(['scripts/run.mjs'],read,exists)),['fixtures/qa/key.pem','scripts/child.mjs','scripts/run.mjs']);
 assert.deepEqual(Object.keys(closure(['scripts/mentions.mjs'],read,exists)),['scripts/mentions.mjs'],'a path a non-launching script merely mentions is not an input');
});

test('ledger validation is neither pinned nor followed; a ledger-named file that runs anything stays a pinned input',()=>{
 const {read,exists}=repo({
  'scripts/qa/run-http.mjs':'import "./tenant-x-credit.mjs";\nimport "./tenant-y-credit.mjs";\nimport "./tenant-table-catalog.mjs";',
  'scripts/qa/tenant-x-credit.mjs':'import "./only-ledger-needs-this.mjs";\nexport const ok=1;',
  'scripts/qa/only-ledger-needs-this.mjs':'export {};',
  'scripts/qa/tenant-y-credit.mjs':'export const r=await fetch("http://127.0.0.1");',
  'scripts/qa/tenant-table-catalog.mjs':'export const rows=[];',
 });
 assert.deepEqual(Object.keys(closure(['scripts/qa/run-http.mjs'],read,exists)),
  ['scripts/qa/run-http.mjs','scripts/qa/tenant-table-catalog.mjs','scripts/qa/tenant-y-credit.mjs']);
 assert.equal(isLedgerSource('tests/tenant-isolation-coverage-inventory.test.mjs','assert.ok(1)'),true);
 assert.equal(isLedgerSource('tests/tenant-x-credit.test.mjs','import {x} from "@/lib/payroll-engine"'),false,'application source makes it runtime');
 assert.equal(isLedgerSource('scripts/qa/tenant-x-credit.mjs','spawnSync(process.execPath,["a"])'),false,'launching a process makes it runtime');
 assert.equal(isLedgerSource('scripts/qa/tenant-x-credit.mjs','new Pool({})'),false,'a database makes it runtime');
 assert.equal(isLedgerSource('scripts/qa/tenant-second-pass-http.mjs',''),false,'an HTTP harness is never ledger by name');
});

test('(v) an unresolvable local import and (vi) an unreviewed non-literal dynamic load fail generation',()=>{
 const {exists}=repo({'src/a.ts':''});
 assert.throws(()=>fileEdges('src/a.ts','import {x} from "./missing";',exists),/Unresolved local proof dependency/);
 assert.throws(()=>fileEdges('src/a.ts','const m=await import(name);',exists),/Unreviewed non-literal dynamic load/);
 assert.throws(()=>fileEdges('src/a.ts','const m=require(`./${name}`);',exists),/Unreviewed non-literal dynamic load/);
 assert.throws(()=>fileEdges('scripts/qa/tenant-money-lifecycle-http.mjs','require(otherPath)',exists),/Unreviewed/,'a reviewed file cannot add a new dynamic call');
});

const receipt=()=>({globalPins:{'package-lock.json':sha('lock')},
 methodPins:{'GET a':{'src/app/api/a/route.ts':sha('A'),'src/lib/engine.ts':sha('E')},'GET b':{'src/app/api/b/route.ts':sha('B'),'src/lib/other.ts':sha('O')}}});
const files={'package-lock.json':'lock','src/app/api/a/route.ts':'A','src/lib/engine.ts':'E','src/app/api/b/route.ts':'B','src/lib/other.ts':'O'};

test('(i) drift in one method\'s own closure withdraws only that method',()=>{
 const r=receipt();
 assert.deepEqual(wageRenewalV2Drift(r,'GET a',repo(files).read),[]);
 const changed=repo({...files,'src/lib/engine.ts':'E2'}).read;
 assert.deepEqual(wageRenewalV2Drift(r,'GET a',changed),['src/lib/engine.ts']);
 assert.deepEqual(wageRenewalV2Drift(r,'GET b',changed),[],'a file outside B\'s closure cannot withdraw B');
});
test('(ii) a changed route and (iii) a changed global-base file are drift; a deleted input is drift',()=>{
 const r=receipt();
 assert.deepEqual(wageRenewalV2Drift(r,'GET b',repo({...files,'src/app/api/b/route.ts':'B2'}).read),['src/app/api/b/route.ts']);
 const lock=repo({...files,'package-lock.json':'lock2'}).read;
 for(const key of ['GET a','GET b'])assert.deepEqual(wageRenewalV2Drift(r,key,lock),['package-lock.json']);
 const {['src/lib/other.ts']:_gone,...rest}=files;
 assert.deepEqual(wageRenewalV2Drift(r,'GET b',repo(rest).read),['src/lib/other.ts']);
 assert.throws(()=>wageRenewalV2Drift(r,'GET c',repo(files).read),/No sealed closure/);
});
test('(iv) a new import can only enter through an edit of a pinned file, which is already drift',()=>{
 const r=receipt();
 const imported=repo({...files,'src/lib/engine.ts':'import {db} from "@/db";\nE'}).read;
 assert.deepEqual(wageRenewalV2Drift(r,'GET a',imported),['src/lib/engine.ts']);
});

test('the real current source seals one closure per withdrawn method that is far smaller than the 668-file union',()=>{
 const inventory=readWageRenewalInventory();
 const {globalPins,methodPins}=sealClosures(inventory.methods);
 for(const f of ['.github/workflows/wage-registry-renewal.yml','package-lock.json','src/proxy.ts','src/db/schema.ts'])assert.ok(globalPins[f],f);
 assert.equal(Object.keys(methodPins).length,75);
 for(const entry of inventory.methods){
  const pins=methodPins[methodKey(entry)];
  assert.equal(pins[entry.path],entry.routeBlobSha,'route pinned: '+methodKey(entry));
  const proof=entry.held.reviewedUncertified.priorProof.file;
  if(proof)assert.ok(pins[proof]||globalPins[proof],'original proof pinned: '+proof);
  for(const f of Object.keys(pins)){assert.ok(!globalPins[f]);assert.ok(!V2_ACCOUNTING_ONLY.includes(f));}
 }
 const reach=file=>Object.values(methodPins).filter(p=>Object.hasOwn(p,file)).length;
 assert.ok(reach('src/lib/payroll-engine.ts')<40,'an engine edit must not withdraw every renewed method');
 assert.ok(reach('src/lib/year-end.ts')<10);
});

test('receipt validation rejects a repeated global pin, a pinned bookkeeping file, an unpinned route and a missing closure',()=>{
 const inventory=readWageRenewalInventory(),entry=inventory.methods.find(e=>e.held.reviewedUncertified.priorProof.file),key=methodKey(entry);
 const proof=entry.held.reviewedUncertified.priorProof.file;
 const globalPins={'.github/workflows/wage-registry-renewal.yml':'1'.repeat(40),'package-lock.json':'2'.repeat(40),'src/proxy.ts':'3'.repeat(40),'src/db/schema.ts':'4'.repeat(40)};
 const good={globalPins,methodPins:{[key]:{[entry.path]:entry.routeBlobSha,[proof]:'5'.repeat(40)}}};
 const check=(r,eligible=new Set([key]))=>validateWageRenewalV2Closures(r,inventory,eligible);
 assert.doesNotThrow(()=>check(good));
 const edit=fn=>{const r=structuredClone(good);fn(r);return r;};
 assert.throws(()=>check(edit(r=>{r.methodPins[key]['package-lock.json']='2'.repeat(40);})),/global pin cannot be repeated/);
 assert.throws(()=>check(edit(r=>{r.methodPins[key]['scripts/qa/wage-registry-renewal-v2.mjs']='6'.repeat(40);})),/Bookkeeping/);
 assert.throws(()=>check(edit(r=>{r.globalPins['tests/helpers/tenant-counts.mjs']='6'.repeat(40);})),/Bookkeeping/);
 assert.throws(()=>check(edit(r=>{r.methodPins[key][entry.path]='7'.repeat(40);})),/exact withdrawn handler/);
 assert.throws(()=>check(edit(r=>{delete r.methodPins[key][proof];})),/Original HTTP assertions/);
 assert.throws(()=>check(edit(r=>{delete r.globalPins['src/proxy.ts'];})),/Global base must pin src\/proxy.ts/);
 assert.throws(()=>check(good,new Set([key,methodKey(inventory.methods.find(e=>e!==entry))])),/Exactly one closure per eligible method/);
 assert.equal(WAGE_RENEWAL_V2_RECEIPT_BLOB,'PENDING_REAL_PG16_HTTP','no v2 execution is sealed in this change');
});

test('no v2 rows: the hold views are identity; a forged v2 row cannot be projected without a sealed receipt',()=>{
 const live=JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json','utf8'));
 assert.equal(wageRenewalV2HoldView(live),live);
 assert.equal(verifyWageRenewalV2Rows(live).size,0);
 const forged=structuredClone(live),entry=readWageRenewalInventory().methods[0];
 const row=forged.allApiRouteFiles[entry.path].methods.find(r=>r.name===entry.verb);
 Object.assign(row,{status:'COVERED',testedBy:{kind:WAGE_RENEWAL_V2_KIND}});
 assert.throws(()=>wageRenewalHoldView(forged),/not been sealed/);
});

test('log extraction keeps one-line and pretty-printed JSON results, PASS lines and TENANT_ env echoes',()=>{
 const log=['2026-11-17T00:12:53.9276892Z ##[group]Run node x','2026-11-17T00:12:53.9Z   TENANT_DL02_PROOF: isolated-ci-only',
  '2026-11-17T00:12:54.0Z {"kind":"one","n":1}','2026-11-17T00:12:54.1Z {','2026-11-17T00:12:54.1Z   "kind": "pretty",','2026-11-17T00:12:54.1Z   "rows": [1, 2]','2026-11-17T00:12:54.1Z }',
  '2026-11-17T00:12:55.0Z PASS anonymous visibility /api/health','2026-11-17T00:12:55.0Z {not json',
  '2026-11-17T00:09:10.2Z PAYROLL_RUN_ORACLE_PASS {"methods":19}','2026-11-17T00:25:29.2Z # {"kind":"tap"}',
  '2026-11-17T00:25:29.3Z lowercase prefix {"kind":"ignored"}'].join('\n');
 const r=extractLogRecords(log);
 assert.deepEqual(r.json,[{kind:'one',n:1},{kind:'pretty',rows:[1,2]},{methods:19},{kind:'tap'}]);
 assert.equal(r.env.TENANT_DL02_PROOF,'isolated-ci-only');
 assert.ok(r.lines.includes('PASS anonymous visibility /api/health'));
 assert.doesNotThrow(()=>new Function('return '+extractLogRecords.toString())(),'the extractor must run unchanged in a browser');
});

test('packets map every reviewed GitHub job name, reject unknown names and require every matrix leg',()=>{
 const names=jobIdentityByName();
 assert.equal(names.size,42);
 assert.deepEqual(names.get('Wage renewal / remittance / statutory-action-pg16-true'),{jobKey:'remittance__remittance-action-pg16',variant:{multi_entity:'true'}});
 assert.deepEqual(names.get('Wage renewal / table / table (flagged-reads)'),{jobKey:'table__table',variant:{profile:'flagged-reads'}});
 const steps={runId:1,headSha:'a'.repeat(40),jobs:[{jobId:9,name:'Wage renewal / bogus',conclusion:'success',steps:[]}]};
 assert.throws(()=>buildPackets(steps,{jobs:{}}),/Unreviewed job name/);
 const one={runId:1,headSha:'a'.repeat(40),jobs:[{jobId:9,name:'Wage renewal / table / table (default)',conclusion:'success',steps:[]}]};
 assert.throws(()=>buildPackets(one,{jobs:{9:{json:[],lines:[],env:{}}}}),/Every job and matrix leg of table/);
});
