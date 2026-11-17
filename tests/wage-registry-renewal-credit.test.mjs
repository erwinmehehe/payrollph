import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import {readWageRenewalInventory} from '../scripts/qa/wage-registry-renewal-plan.mjs';
import {requiredWageFamilies,methodKey} from '../scripts/qa/wage-registry-renewal-methods.mjs';
import {validateWageReceiptResults,readWageRenewalReceipt,WAGE_RENEWAL_RECEIPT,WAGE_RENEWAL_RECEIPT_BLOB,wageRenewalHoldView,isExactHistoricalLoaderChange} from '../scripts/qa/wage-registry-renewal-verify.mjs';
import {reconcileWageRenewal} from '../scripts/qa/wage-registry-renewal-credit.mjs';
import {assertWageLedgerDelta} from './helpers/wage-source-holds.mjs';
const receipt=()=>JSON.parse(readFileSync(WAGE_RENEWAL_RECEIPT,'utf8'));
test('historical loader compatibility cannot change an assertion, add executable code or alter an HTTP proof',()=>{
 const r=receipt(),file='tests/tenant-filing-outcome-contract.test.mjs',raw=readFileSync(file,'utf8');
 assert.equal(isExactHistoricalLoaderChange(file,r.sourcePins[file],raw),true);
 assert.equal(isExactHistoricalLoaderChange(file,r.sourcePins[file],raw.replace('assert.match(manifest.acceptanceStatus','assert.doesNotMatch(manifest.acceptanceStatus')),false);
 assert.equal(isExactHistoricalLoaderChange(file,r.sourcePins[file],raw+'\nconsole.log("extra code");'),false);
 assert.equal(isExactHistoricalLoaderChange('scripts/qa/tenant-filing-outcome-http.mjs',r.sourcePins[file],raw),false);
});

test('all 75 exact methods have bounded, complete original proof family requirements',()=>{
 const entries=readWageRenewalInventory().methods;
 for(const e of entries)assert.ok(requiredWageFamilies(e).length>0,methodKey(e));
 assert.equal(requiredWageFamilies(entries.find(e=>e.path==='src/app/api/automation-studio/route.ts')).length,8);
 const payroll=entries.filter(e=>e.path.startsWith('src/app/api/payroll-runs/'));
 assert.equal(payroll.length,19);for(const e of payroll)assert.ok(requiredWageFamilies(e).includes('oracle'));
});

test('actual captured current-source job output derives eligibility without promoting anything',()=>{
 assert.ok(existsSync(WAGE_RENEWAL_RECEIPT),'A real executed candidate is required');
 const before=readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json');
 const r=receipt(),eligible=validateWageReceiptResults(r);
 assert.equal(eligible.size,r.methods.length);assert.ok(eligible.size>0&&eligible.size<=75);
 assert.deepEqual(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json'),before);
});

test('missing legs, failed jobs, false checkout claims, fabricated methods and changed proof results fail closed',()=>{
 const original=receipt(),family=Object.keys(original.families).find(f=>original.families[f].every(j=>!j.metadataOnly));
 for(const mutate of [
  r=>{r.families[family].pop();},
  r=>{r.families[family][0].conclusion='failure';},
  r=>{r.families[family][0].sourceHead='wrong';},
  r=>{r.families[family][0].exactHeadCheckoutVerified=false;},
  r=>{r.families[family][0].metadataOnly=true;},
  r=>{r.families[family][0].postgresMajor=18;},
  r=>{r.families[family][0].steps[0].conclusion='failure';},
  r=>{r.methods.push('POST src/app/api/never-proven/route.ts');},
  r=>{r.productionAccepted=true;},
  r=>{r.creditsAtExecution=75;},
 ]){const r=structuredClone(original);mutate(r);assert.throws(()=>validateWageReceiptResults(r));}
 const table=original.families.yearend?.[0];
 if(table){for(const mutate of [r=>{r.rows=0;},r=>{r.discriminatingProofs=0;},r=>{r.victimDatabaseUnchanged=false;}]){
  const r=structuredClone(original),result=r.families.yearend[0].results.find(x=>x.kind==='tenant-write-table-proof');mutate(result);
  assert.throws(()=>validateWageReceiptResults(r));
 }}
});

test('unsealed or altered execution cannot change the manifest or borrow the old credit writer',()=>{
 const path='scripts/qa/tenant-isolation-coverage-manifest.json',before=readFileSync(path);
 if(WAGE_RENEWAL_RECEIPT_BLOB==='PENDING_REAL_PG16_HTTP'){
  assert.throws(()=>readWageRenewalReceipt(),/not been sealed/);
  assert.throws(()=>reconcileWageRenewal({write:true}),/not been sealed/);
 }else{
  assert.throws(()=>readWageRenewalReceipt(p=>p===WAGE_RENEWAL_RECEIPT?Buffer.concat([readFileSync(p),Buffer.from('\n')]):readFileSync(p)),/receipt changed/);
  const m=JSON.parse(before),entry=readWageRenewalInventory().methods[0];
  m.allApiRouteFiles[entry.path].methods.find(x=>x.name===entry.verb).testedBy.claimed='invented';
  assert.throws(()=>wageRenewalHoldView(m));
 }
 assert.deepEqual(readFileSync(path),before);
});

test('the ACTUAL live manifest has only sealed complete-method renewals and exact generated totals',()=>{
 const m=JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json','utf8'));
 assert.equal(assertWageLedgerDelta(assert,m),true);
 const rows=Object.values(m.allApiRouteFiles).flatMap(f=>f.methods);
 assert.equal(m.metrics.coveredAfter,rows.filter(r=>r.status==='COVERED').length);
 assert.equal(m.metrics.gap,rows.filter(r=>r.status==='GAP').length);
 if(WAGE_RENEWAL_RECEIPT_BLOB==='PENDING_REAL_PG16_HTTP'){
  assert.equal(m.metrics.gap,readWageRenewalInventory().methods.length);
 }else{
  const r=readWageRenewalReceipt(),eligible=new Set(r.methods);
  for(const e of readWageRenewalInventory().methods){
   const row=m.allApiRouteFiles[e.path].methods.find(x=>x.name===e.verb);
   assert.equal(row.status,eligible.has(methodKey(e))?'COVERED':'GAP');
  }
  assert.throws(()=>readWageRenewalReceipt(p=>p==='src/lib/wage-orders.ts'?Buffer.concat([readFileSync(p),Buffer.from('\nchanged')]):readFileSync(p)),/source drift|source changed/);
  assert.equal(reconcileWageRenewal({write:false}).changed,false,'Live accounting must be generated by the bounded writer');
 }
});
