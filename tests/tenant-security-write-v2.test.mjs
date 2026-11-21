import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {
 SECURITY_V2_KIND,SECURITY_V2_RECEIPT,SECURITY_V2_RECEIPT_BLOB,SECURITY_V2_TARGETS,blob,
 creditSecurityV2,hasSecurityV2Promotions,readSecurityV2Receipt,securityV2Drift,securityV2HoldView,securityV2RenewalDelta,
 validateSecurityV2Receipt,verifySecurityV2Rows,verifySecurityV2Results,withdrawDriftedSecurityV2,securityV2Row,
} from '../scripts/qa/security-write-v2-credit.mjs';

const live=()=>JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json','utf8'));
const receipt=()=>JSON.parse(readFileSync(SECURITY_V2_RECEIPT,'utf8'));
const bio=SECURITY_V2_TARGETS[0],dev=SECURITY_V2_TARGETS[1];
const rowOf=(m,t)=>m.allApiRouteFiles[t.path].methods.find(x=>x.name===t.verb);
/** A reader that serves one changed file and the real bytes for everything else. */
const readWith=(file,text)=>(f,...a)=>f===file?Buffer.from(text):readFileSync(f,...a);

test('the sealed receipt is byte-exact, from one successful job, and zero credit at execution',()=>{
 assert.match(SECURITY_V2_RECEIPT_BLOB,/^[a-f0-9]{40}$/);
 assert.equal(blob(readFileSync(SECURITY_V2_RECEIPT)),SECURITY_V2_RECEIPT_BLOB);
 const r=readSecurityV2Receipt();
 assert.equal(r.creditsAtExecution,0);assert.equal(r.productionAccepted,false);assert.equal(r.independentlyAccepted,false);
 assert.equal(r.execution.conclusion,'success');assert.ok(r.execution.steps.every(s=>s.conclusion==='success'));
 assert.deepEqual(r.methods,SECURITY_V2_TARGETS.map(t=>t.key));
});

test('each method is bound to its own closure; the documents route is in neither, so it cannot withdraw them again',()=>{
 const r=receipt();
 for(const key of r.methods){
  const pins={...r.globalPins,...r.methodPins[key]};
  assert.ok(!Object.hasOwn(pins,'src/app/api/documents/route.ts'),'documents route must not be a closure input of '+key);
  assert.ok(!Object.hasOwn(pins,'src/app/api/hcm/documents/route.ts'));
 }
 const [a,b]=r.methods.map(k=>r.methodPins[k]);
 assert.ok(Object.hasOwn(a,bio.path)&&!Object.hasOwn(a,dev.path),'biometrics closure must not include the developer route');
 assert.ok(Object.hasOwn(b,dev.path)&&!Object.hasOwn(b,bio.path),'developer closure must not include the biometrics route');
});

test('the live ledger carries exactly the two sealed rows and they project back to the captured holds',()=>{
 const m=live(),r=readSecurityV2Receipt();
 assert.equal(hasSecurityV2Promotions(m),true);
 assert.deepEqual([...verifySecurityV2Rows(m)].sort(),r.methods.slice().sort());
 for(const t of SECURITY_V2_TARGETS){
  const row=rowOf(m,t);assert.equal(row.status,'COVERED');assert.equal(row.testedBy.kind,SECURITY_V2_KIND);
  assert.equal(row.testedBy.independentSecurityReview,'PENDING');assert.equal(row.testedBy.productionTested,false);
  assert.equal(row.reviewedUncertified,undefined);assert.deepEqual(row,securityV2Row(t.key,r));
 }
 const before=structuredClone(m),view=securityV2HoldView(m);
 assert.deepEqual(m,before,'projection must not mutate the live manifest');
 for(const t of SECURITY_V2_TARGETS)assert.deepEqual(rowOf(view,t),r.holds[t.key]);
 assert.equal(view.metrics.coveredAfter,m.metrics.coveredAfter-2);assert.equal(view.metrics.gap,m.metrics.gap+2);
});

test('a change to one method\'s own closure withdraws only that method, to its exact hold, with zero credit',()=>{
 const m=live(),r=readSecurityV2Receipt(),devRoute=readFileSync(dev.path,'utf8');
 const read=readWith(dev.path,devRoute+'\n// edited');
 assert.deepEqual(securityV2Drift(r,dev.key,read),[dev.path]);assert.deepEqual(securityV2Drift(r,bio.key,read),[]);
 assert.throws(()=>verifySecurityV2Rows(m,read),/--withdraw-drifted/);
 const {manifest,withdrawn}=withdrawDriftedSecurityV2(m,read);
 assert.deepEqual(withdrawn,[dev.key]);
 assert.deepEqual(rowOf(manifest,dev),r.holds[dev.key]);assert.equal(rowOf(manifest,dev).status,'GAP');
 assert.equal(rowOf(manifest,bio).status,'COVERED');
 assert.equal(manifest.metrics.coveredAfter,m.metrics.coveredAfter-1);assert.equal(manifest.metrics.gap,m.metrics.gap+1);
});

test('a global-base change withdraws both; an unrelated file withdraws neither',()=>{
 const m=live(),r=readSecurityV2Receipt(),pkg=readFileSync('package.json','utf8');
 const read=readWith('package.json',pkg+' ');
 assert.deepEqual(withdrawDriftedSecurityV2(m,read).withdrawn.sort(),[bio.key,dev.key].sort());
 assert.deepEqual(withdrawDriftedSecurityV2(m,readWith('src/app/api/documents/route.ts','changed')).withdrawn,[]);
 assert.deepEqual(securityV2Drift(r,bio.key,readWith('src/app/api/hcm/documents/route.ts','x')),[]);
});

test('forged rows, forged receipts and wrong bases fail closed',()=>{
 const r=readSecurityV2Receipt();
 for(const mutate of [
  m=>{rowOf(m,bio).testedBy.independentSecurityReview='APPROVED';},
  m=>{rowOf(m,bio).testedBy.productionTested=true;},
  m=>{rowOf(m,dev).testedBy.ownPositiveLine=1;},
  m=>{rowOf(m,dev).testedBy.receiptBlobSha='0'.repeat(40);},
  m=>{rowOf(m,dev).reason+=' certified';},
  m=>{m.allApiRouteFiles[bio.path].gitBlobSha='0'.repeat(40);},
 ]){const m=live();mutate(m);assert.throws(()=>verifySecurityV2Rows(m));}
 // A receipt that does not hash to the sealed blob is refused outright.
 assert.throws(()=>readSecurityV2Receipt(readWith(SECURITY_V2_RECEIPT,readFileSync(SECURITY_V2_RECEIPT,'utf8')+' ')),/receipt changed/);
 // Only the exact captured hold may be promoted: a GAP row with a different reason is not it.
 const m=securityV2HoldView(live());rowOf(m,bio).reason+=' edited';assert.throws(()=>creditSecurityV2(m),/exact captured hold/);
 // A promotion must come from the exact base hold.
 const base=securityV2HoldView(live());
 assert.equal(securityV2RenewalDelta(base,live()),2);
 assert.equal(securityV2RenewalDelta(live(),live()),0);
 const edited=structuredClone(base);rowOf(edited,dev).reason+=' edited';
 assert.throws(()=>securityV2RenewalDelta(edited,live()),/exact captured hold/);
 assert.deepEqual(creditSecurityV2(live()).promoted,[],'crediting twice is a no-op');
});

test('the proof counters the job printed must still be the complete two-attacker proof',()=>{
 const r=receipt();
 for(const mutate of [
  x=>{x.biometrics.deniedChecks=8;},x=>{x.biometrics.postgresMajor=18;},x=>{x.biometrics.crossTenantBadgeUnmatched=false;},
  x=>{x.developer.result='FAIL';},x=>{x.developer.independentAttackers=1;},x=>{x.developer.victimSqlAndAuditUnchanged=false;},
  x=>{x.developer.newCoverageCredits=1;},x=>{x.biometrics.productionCertified=true;},
 ]){const results=structuredClone(r.results);mutate(results);assert.throws(()=>verifySecurityV2Results(results));}
 for(const mutate of [
  x=>{x.execution.steps[6].conclusion='failure';},x=>{x.execution.conclusion='failure';},x=>{x.creditsAtExecution=1;},
  x=>{x.productionAccepted=true;},x=>{x.execution.testedHead='abc';},
  x=>{x.holds[bio.key].status='COVERED';},x=>{x.methodPins[dev.key][dev.proof]='0'.repeat(40);},
 ]){const copy=structuredClone(r);mutate(copy);assert.throws(()=>validateSecurityV2Receipt(copy));}
});
