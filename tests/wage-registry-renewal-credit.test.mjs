import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {readWageRenewalInventory} from '../scripts/qa/wage-registry-renewal-plan.mjs';
import {requiredWageFamilies,methodKey} from '../scripts/qa/wage-registry-renewal-methods.mjs';
import {validateWageReceiptResults,readWageRenewalReceipt,WAGE_RENEWAL_RECEIPT,WAGE_RENEWAL_RECEIPT_BLOB,wageRenewalHoldView,isExactHistoricalLoaderChange} from '../scripts/qa/wage-registry-renewal-verify.mjs';
import {reconcileWageRenewal} from '../scripts/qa/wage-registry-renewal-credit.mjs';
import {verifyWageRenewalEngineWithdrawal} from '../scripts/qa/wage-registry-renewal-supersession.mjs';
import {assertWageLedgerDelta} from './helpers/wage-source-holds.mjs';
import {WAGE_RENEWAL_V2_KIND} from '../scripts/qa/wage-registry-renewal-v2.mjs';
import {renewalWorkflow} from '../scripts/qa/wage-registry-renewal-workflow.mjs';
const receipt=()=>JSON.parse(readFileSync(WAGE_RENEWAL_RECEIPT,'utf8'));
test('source-only Worker 360 CI validates current receipts without any npm dependency',()=>{
 const code=`import {registerHooks} from 'node:module';
 registerHooks({resolve(s,c,n){if(!s.startsWith('node:')&&!s.startsWith('.')&&!s.startsWith('file:'))throw Error('npm dependency '+s);return n(s,c)}});
 const assert=(await import('node:assert/strict')).default;
 const fs=await import('node:fs');
 const {verifySixPageCredits,historicSixPageView,selectedTargets}=await import('./scripts/qa/tenant-six-scoped-page-credit.mjs');
 const {verifyFivePageCredits,historicWorker360ProofView}=await import('./scripts/qa/tenant-five-scoped-page-credit.mjs');
 const {verifyWorker360PageCredit}=await import('./scripts/qa/tenant-five-method-credit-verify.mjs');
 const {verifyWorker360LegalEmployerCredits}=await import('./scripts/qa/tenant-worker360-legal-employer-credit.mjs');
 const live=JSON.parse(fs.readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json','utf8'));
 assert.equal(verifySixPageCredits(live),selectedTargets().length);
 const historical=historicSixPageView(live);assert.equal(verifyFivePageCredits(historical),5);
 const worker=historicWorker360ProofView(historical);assert.equal(verifyWorker360LegalEmployerCredits(worker),2);assert.equal(verifyWorker360PageCredit(worker),16);`;
 assert.doesNotThrow(()=>execFileSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'}));
});
test('dependency-free sealed job catalog equals every actual workflow job and matrix variant',()=>{
 const expected={};
 for(const [jobKey,job] of Object.entries(renewalWorkflow().jobs)){
  const family=jobKey.split('__')[0],matrix=job.strategy?.matrix||{};
  assert.ok(!matrix.include&&!matrix.exclude);
  const variants=Object.entries(matrix).reduce((all,[key,values])=>all.flatMap(v=>values.map(value=>({...v,[key]:value}))),[{}]);
  (expected[family]??=[]).push(...variants.map(variant=>({jobKey,variant})));
 }
 assert.deepEqual(JSON.parse(readFileSync('scripts/qa/wage-registry-renewal-jobs.json','utf8')),expected);
});
test('historical loader compatibility cannot change an assertion, add executable code or alter an HTTP proof',()=>{
 const r=receipt(),file='tests/tenant-filing-outcome-contract.test.mjs',raw=readFileSync(file,'utf8');
 assert.equal(isExactHistoricalLoaderChange(file,r.sourcePins[file],raw),true);
 assert.equal(isExactHistoricalLoaderChange(file,r.sourcePins[file],raw.replace('assert.match(manifest.acceptanceStatus','assert.doesNotMatch(manifest.acceptanceStatus')),false);
 assert.equal(isExactHistoricalLoaderChange(file,r.sourcePins[file],raw+'\nconsole.log("extra code");'),false);
 assert.equal(isExactHistoricalLoaderChange('scripts/qa/tenant-filing-outcome-http.mjs',r.sourcePins[file],raw),false);
 const four='scripts/qa/tenant-four-scoped-page-credit.mjs',source=readFileSync(four,'utf8');
 assert.equal(isExactHistoricalLoaderChange(four,r.sourcePins[four],source),true);
 assert.equal(isExactHistoricalLoaderChange(four,r.sourcePins[four],source.replace('assert.equal(held, 19,','assert.equal(held, 18,')),false);
 assert.equal(isExactHistoricalLoaderChange(four,r.sourcePins[four],source.replace('assert.deepEqual(manifest, expected,','assert.notDeepEqual(manifest, expected,')),false);
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
  // The captured hold (zero credit) or its v2 per-method renewal (credited): any edit fails closed.
  m.allApiRouteFiles[entry.path].methods.find(x=>x.name===entry.verb).reason+=' forged';
  assert.throws(()=>verifyWageRenewalEngineWithdrawal(m),/Stale renewal must be fully withdrawn|provenance changed/);
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
  assert.equal(verifyWageRenewalEngineWithdrawal(m).size,75);
  for(const entry of readWageRenewalInventory().methods){
    const row=m.allApiRouteFiles[entry.path].methods.find(x=>x.name===entry.verb);
    // Either the exact captured hold or a v2 per-method renewal (verified above through the v2 hold view).
    if(row.testedBy?.kind===WAGE_RENEWAL_V2_KIND){assert.equal(row.status,'COVERED');continue;}
    assert.equal(row.status,'GAP');assert.equal(row.testedBy,null);
  }
  assert.throws(()=>readWageRenewalReceipt(),/Executed runtime\/HTTP\/source drift/);
  assert.throws(()=>reconcileWageRenewal({write:false}),/Executed runtime\/HTTP\/source drift/);
 }
});
