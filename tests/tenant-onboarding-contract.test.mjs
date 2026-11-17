import {readWageWithdrawalFixture} from './helpers/wage-renewal-fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {guard,METHODS,verifyOwned,rejectAnother} from '../scripts/qa/tenant-onboarding-contract.mjs';
import {onboardingEnv} from '../scripts/qa/tenant-onboarding-env.mjs';
import {verifyReceipt,verifyCredit} from '../scripts/qa/tenant-onboarding-credit.mjs';
import {verifyWageRegistrySourceHold,historicWageRegistryProofView} from '../scripts/qa/wage-registry-source-hold.mjs';
import {verifyAllTransitiveWageHolds} from '../scripts/qa/wage-registry-transitive-source-hold.mjs';
import {validIsoDate} from '../src/lib/payroll-period-validation.ts';
// These hashes were checked against unchanged GET bodies in main@ff0ba9f27503a.
// Pin actual source bytes instead of requiring shallow CI checkouts to contain
// a historical git commit object. A changed GET still fails this proof guard.
const sha256 = text => createHash('sha256').update(text).digest('hex');
test('onboarding refuses hosted targets, provider credentials, workers and unknown profiles before DB imports',()=>{
 const good={...onboardingEnv('legacy'),NODE_ENV:undefined};assert.doesNotThrow(()=>guard(good));
 for(const change of[{DATABASE_URL:'postgresql://postgres@db.example.test/app_db'},{DATABASE_URL:'postgresql://postgres@127.0.0.1/live'},{DATABASE_URL:good.DATABASE_URL+'?options=unsafe'},{SECURITY_SMOKE_URL:'https://127.0.0.1:3000'},{NODE_ENV:'production'},{WORKER_ENABLED:'true'},{CENTRAL_SCHEDULER_ENABLED:'true'},{MULTI_ENTITY_ENABLED:'true'},{XENDIT_SECRET_KEY:'not-a-real-key'},{TENANT_ONBOARDING_PROFILE:'unknown'},{EMPLOYEE_IMPORT_PREVIEW_ENABLED:'true'}])assert.throws(()=>guard({...good,...change}));
 assert.throws(()=>onboardingEnv('other'));const source=readFileSync('scripts/qa/tenant-onboarding-http.mjs','utf8');assert.ok(source.indexOf('guard();')<source.indexOf("await import('../../src/db"));
});
test('calendar date regression accepts actual ISO dates and refuses impossible dates on all intake paths',()=>{
 for(const date of['2026-01-06','2024-02-29'])assert.equal(validIsoDate(date),true);
 for(const date of['2026-02-30','2026-02-29','2026-13-01','not-a-date','2026-1-6'])assert.equal(validIsoDate(date),false);
 const employees=readFileSync('src/app/api/employees/route.ts','utf8'),hire=readFileSync('src/app/api/recruitment/hire/route.ts','utf8');
 for(const name of['startDate','nextStartDate','payEffectiveDate','restDayEffectiveDate'])assert.ok(employees.includes('!validIsoDate('+name+')'));
 assert.ok(hire.includes('!validIsoDate(startDate)'));
 const get=source=>source.slice(source.indexOf('export async function GET('),source.indexOf('/**\n * Creates an employee'));
 assert.equal(sha256(get(employees.replaceAll('\r\n','\n'))),
   'e50064c9d674518e4a8cf0d6002c3274fae802d9630d662b9cd01d94663007a3',
   'GET body/proof must match verified main@ff0ba9f27503a bytes');
});
test('legacy import assigns an authorized active legal employer atomically with worker/profile/batch/audit',()=>{
 const source=readFileSync('src/app/api/employees/import/route.ts','utf8');
 assert.match(source,/await ensurePrimaryLegalEntity\(organizationId, user.id, tx\)/);
 assert.match(source,/if \(!legalEmployer\?\.active\) throw new Error\("EMPLOYEE_IMPORT_LEGAL_EMPLOYER_REQUIRED"\)/);
 assert.match(source,/legalEntityId: legalEmployer.id/);
 assert.ok(source.indexOf('await db.transaction')<source.indexOf('await ensurePrimaryLegalEntity'));
 const get=s=>s.replaceAll('\r\n','\n').split('export async function GET(')[1];
 assert.equal(sha256(get(source)),
   'f2c9e7c7321bc9dc841ce7979b8b2bc49cbe1551b679fbd5ceb65e4a4a6a1257',
   'import-history GET/proof must match verified main@ff0ba9f27503a bytes');
});
test('owned verifier requires actual employer, persisted mutation, actor audit and unchanged payroll',()=>{
 const b={workers:[],audit:[],runs:[],entries:[]},a={workers:[{id:10,organizationId:7,startDate:'2026-01-06'}],audit:[{id:2,organizationId:7,actor:'fictional'}],runs:[],entries:[]},ctx={org:{id:7},owner:{name:'fictional'}},spec={table:'workers',id:10,fields:{startDate:'2026-01-06'},created:true};
 assert.doesNotThrow(()=>verifyOwned(b,a,ctx,spec));
 for(const after of[{...a,workers:[]},{...a,audit:[]},{...a,runs:[{id:1}]},{...a,workers:[{...a.workers[0],organizationId:8}]},{...a,workers:[{...a.workers[0],startDate:'2026-01-05'}]}])assert.throws(()=>verifyOwned(b,after,ctx,spec));
 assert.throws(()=>verifyOwned(a,a,ctx,{...spec,created:false}));
 assert.doesNotThrow(()=>rejectAnother((before,after,c)=>verifyOwned(before,after,c,spec),b,a,{...ctx,org:{id:8}}));
 assert.throws(()=>rejectAnother(()=>{},b,a,ctx),/proof accepts another employer's data/);
});
test('both profiles execute real intake, independent approvals, forged references and read-only blocked preview',()=>{
 const proof=readFileSync('scripts/qa/tenant-onboarding-http.mjs','utf8'),workflow=readFileSync('.github/workflows/tenant-onboarding-http.yml','utf8');
 for(const fragment of["['ATTA','ATTB']",'victim[key].id>6','await unchanged()','rejectAnother(check',"'/api/approvals/'",'e.checker','new direct/hired workers reach canonical preview','blocked preview must never look like zero pay','denied request is atomic/no own changes','no premature worker','submission is idempotent','preview is read-only','decryptGovernmentId','decryptBankAccount'])assert.ok(proof.includes(fragment),fragment);
 assert.match(workflow,/profile: \[legacy, preview\]/);assert.match(workflow,/image: postgres:16/);assert.match(workflow,/env -u NODE_ENV node --import tsx scripts\/qa\/tenant-onboarding-http.mjs/);
 assert.deepEqual(METHODS,['POST employees/import','POST employees','PATCH employees','POST recruitment/hire']);
});
test('onboarding historical receipts remain sealed; two wage-dependent methods are zero-credit held',()=>{
 const receipt=verifyReceipt();for(const mutate of[r=>r.runs[0].actions.pop(),r=>r.runs[1].own++,r=>r.sources[0].sha256='0'.repeat(64),r=>r.mutation.rejected=false,r=>r.runs[0].victimUnchanged=false]){const copy=structuredClone(receipt);mutate(copy);assert.throws(()=>verifyReceipt(copy));}
 const manifest=readWageWithdrawalFixture();
 for(const verb of ['POST','PATCH']){
   const path='src/app/api/employees/route.ts',method=manifest.allApiRouteFiles[path].methods.find(m=>m.name===verb);
   assert.equal(method.status,'GAP');assert.equal(method.testedBy,null);
   assert.ok(verifyWageRegistrySourceHold(manifest,path,verb),
     'A stale employees source must never borrow the old onboarding credit');
 }
 assert.equal(verifyAllTransitiveWageHolds(manifest).size,47);
 const historic=historicWageRegistryProofView(manifest);
 for(const [verb,route] of [['POST','employees/import'],['POST','recruitment/hire']]){
  const path='src/app/api/'+route+'/route.ts';
  const current=manifest.allApiRouteFiles[path].methods.find(m=>m.name===verb);
  const prior=historic.allApiRouteFiles[path].methods.find(m=>m.name===verb);
  if(route==='employees/import'){
   assert.equal(current.status,'GAP',"Changed wage import cannot inherit onboarding credit");
   assert.equal(current.testedBy,null);
   assert.equal(current.reviewedUncertified?.kind,'wage-registry-transitive-dependency-source-withdrawal');
   assert.equal(current.reviewedUncertified?.coverageCredits,0);
   assert.deepEqual(prior.testedBy,current.reviewedUncertified.priorProof);
  }else{
   assert.equal(current.status,'COVERED',"Unrelated recruitment/hire receipt stays active");
   assert.deepEqual(prior.testedBy,current.testedBy);
  }
  assert.equal(prior.status,'COVERED');
  assert.ok(verifyCredit(verb+' '+route,prior),
   "Historical receipt must keep exact own/victim proof without crediting the new wage source");
 }
 const importMethod=historic.allApiRouteFiles['src/app/api/employees/import/route.ts'].methods.find(m=>m.name==='POST');
 importMethod.testedBy.ownPositiveLine++;
 assert.throws(()=>verifyCredit('POST employees/import',importMethod));
 assert.equal(manifest.allApiRouteFiles['src/app/api/employees/import/route.ts'].methods[0].testedBy,null);
});
