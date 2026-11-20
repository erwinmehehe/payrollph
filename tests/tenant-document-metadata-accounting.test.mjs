import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {reviewedDocumentSourceHoldCount,reviewedDocumentSourceWithdrawals,protectedDocumentCreditKeys,sourceHoldArchive} from '../scripts/qa/document-source-accounting.mjs';
import {isExactHistoricalLoaderChange} from '../scripts/qa/wage-registry-renewal-verify.mjs';
import {baseTenantManifest,assertLiveTenantCounts} from './helpers/tenant-counts.mjs';
import {hasSeparationPromotions,separationRoute,verifySeparationRenewal} from '../scripts/qa/separation-pg16-credit.mjs';
const paths=['src/app/api/documents/route.ts','src/app/api/hcm/documents/route.ts'];
const load=()=>JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json'));

test('only the exact metadata methods and two dependent security writes may lose source-current credits',()=>{
 const m=load(),before=structuredClone(m);
 const renewed=hasSeparationPromotions(m.allApiRouteFiles[separationRoute])?verifySeparationRenewal(m):0;
 assert.equal(reviewedDocumentSourceHoldCount(m),paths.length*2+2+1+3-renewed);
 const base=baseTenantManifest().manifest;
 const newlyWithdrawn=[...protectedDocumentCreditKeys(m)].filter(key=>{
   const at=key.indexOf(' '),verb=key.slice(0,at),path=key.slice(at+1);
   return base.allApiRouteFiles[path].methods.find(row=>row.name===verb).status==='COVERED';
 });
 assert.deepEqual([...reviewedDocumentSourceWithdrawals(base,m)].sort(),newlyWithdrawn.sort());
 assert.equal(reviewedDocumentSourceWithdrawals(m,m).size,0,'Inherited holds are never counted twice');
 assertLiveTenantCounts(assert,m);
 assert.deepEqual(m,before);
 for(const path of paths)for(const row of m.allApiRouteFiles[path].methods) {
   assert.equal(row.status,'GAP');assert.equal(row.testedBy,null);
   assert.equal(row.reviewedUncertified.coverageCredits,0);
 }
});

test('restored credits, false execution, changed receipt and removed guards cannot borrow the hold',()=>{
 for(const path of [...paths,"src/app/api/separation/route.ts"])for(const mutate of [
  f=>{f.methods[0].status='COVERED';},
  f=>{f.methods[0].testedBy={file:'fabricated.mjs'};},
  f=>{f.methods[0].reviewedUncertified.coverageCredits=1;},
  f=>{f.methods[0].reviewedUncertified.exactHeadPg16Http='PASS';},
  f=>{f.methods.pop();},
  f=>{f.gitBlobSha='0'.repeat(40);},
 ]){
  const m=load();
  if(path===separationRoute)m.allApiRouteFiles[path]=sourceHoldArchive().variants.find(v=>v.name==='phase25-separation').records[path];
  mutate(m.allApiRouteFiles[path]);assert.throws(()=>reviewedDocumentSourceHoldCount(m));
 }
 for(const path of paths)assert.throws(()=>reviewedDocumentSourceHoldCount(load(),p=>p===path
   ?Buffer.concat([readFileSync(p),Buffer.from('\n// unreviewed')]):readFileSync(p)));
});

test('separation renewal rejects a partial promotion and runtime pin drift',()=>{
 const m=load();
 if(!hasSeparationPromotions(m.allApiRouteFiles[separationRoute]))return;
 assert.equal(verifySeparationRenewal(m),3);
 const receipt=m.allApiRouteFiles[separationRoute];
 receipt.methods[0].status='GAP';
 assert.throws(()=>verifySeparationRenewal(m),/sealed three-method separation renewal/);
 assert.throws(()=>verifySeparationRenewal(load(),p=>p==='src/lib/final-pay.ts'?Buffer.from('changed'):readFileSync(p)),/Separation proof input changed/);
});

test('historical page accounting permits only the exact added document-withdrawal check',()=>{
 const file='scripts/qa/tenant-five-scoped-page-credit.mjs',source=readFileSync(file,'utf8');
 const pin='8cc67f5af25a9f51e35ca6468b566daefb5ad489';
 assert.equal(isExactHistoricalLoaderChange(file,pin,source),true);
 assert.equal(isExactHistoricalLoaderChange(file,pin,source.replace('assertMkt01Receipt(m)','1')),false);
 const m=load(),path='src/app/api/workforce/attendance-exceptions/route.ts';
 m.allApiRouteFiles[path].methods[0].status='GAP';
 m.allApiRouteFiles[path].methods[0].testedBy=null;
 assert.throws(()=>assertLiveTenantCounts(assert,m));
});
