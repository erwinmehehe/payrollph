import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {STUDIO_POST_PATH,STUDIO_RECEIPT,readStudioPostReceipt,verifyStudioPostResults,verifyStudioPostCredit,reconcileStudioPostCredit} from '../scripts/qa/tenant-studio-post-credit.mjs';
import {RENEWAL_FILE,readStudioDependencyRenewal,verifyRenewalResults} from '../scripts/qa/tenant-studio-dependency-renewal.mjs';
const manifest=()=>JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json'));
const clone=x=>JSON.parse(JSON.stringify(x));
test('only the complete eight-job, eleven-action Studio cohort earns one distinct method',()=>{
 const r=readStudioPostReceipt();assert.equal(Object.keys(r.actionProofs).length,11);assert.equal(Object.keys(r.cohort).length,8);
 assert.equal(verifyStudioPostCredit(manifest()),1);assert.equal(reconcileStudioPostCredit({write:false}).credited,0);
 assert.equal(r.cohort.scope.result.resolution.families.length,6);
});
test('MKT-01 operator-only GET cannot rewrite or multiply the separate Studio credit',()=>{
 const m=manifest(),operator=m.allApiRouteFiles['src/app/api/marketing/leads/route.ts'].methods.find(x=>x.name==='GET');
 assert.equal(operator.status,'COVERED');
 assert.equal(operator.testedBy.operatorScoped,true);
 assert.equal(operator.testedBy.publicByDesign,false);
 assert.equal(m.metrics.coveredAfter,459);assert.equal(m.metrics.gap,4);
 assert.match(m.acceptanceStatus,/SOLO_VERIFIED_DEV_RECOVERY Studio POST credit: 458 COVERED \/ 5 GAP;/);
 assert.doesNotMatch(m.acceptanceStatus,/SOLO_VERIFIED_DEV_RECOVERY Studio POST credit: 459 COVERED \/ 4 GAP;/);
 const result=reconcileStudioPostCredit({write:false});
 assert.equal(result.credited,0);
 assert.equal(manifest().acceptanceStatus,m.acceptanceStatus);
});

test('missing modes, borrowed jobs, failed positives or real-provider claims cannot pass',()=>{
 const r=readStudioPostReceipt();for(const mutate of [x=>delete x.cohort.language,x=>delete x.cohort.sessions,x=>x.cohort.sessions.result.sharedGlobalSessionPreserved=false,x=>delete x.actionProofs['save-rule'],
  x=>x.cohort.scope.job=x.cohort.draft.job,x=>x.cohort.scope.conclusion='failure',x=>x.cohort.scope.result.own=0,
  x=>x.cohort.scope.result.resolution.families.pop(),x=>x.cohort.scope.result.unchangedVictim=false,
  x=>x.cohort.language.result.ownSaves=0,x=>x.providerCalls=1,x=>x.independentlyAccepted=true]){
   const changed=clone(r);mutate(changed);assert.throws(()=>verifyStudioPostResults(changed));
  }
});
test('every executed source seal and both immutable receipts reject drift',()=>{
 const r=readStudioPostReceipt(),cache=new Map();const bytes=p=>{if(!cache.has(p))cache.set(p,readFileSync(p));return cache.get(p);};
 for(const path of [...Object.keys(r.inputBlobs),STUDIO_RECEIPT,RENEWAL_FILE]){
  const read=(p,encoding)=>{const value=p===path?Buffer.concat([bytes(p),Buffer.from(' changed')]):bytes(p);return encoding?value.toString(encoding):value;};
  assert.throws(()=>readStudioPostReceipt(read),undefined,path);
 }
});
test('all five dependency families require their own actual positive and denial results',()=>{
 const r=readStudioDependencyRenewal();assert.equal(Object.keys(r.families).length,5);
 for(const mutate of [x=>delete x.families.approvals,x=>x.families.approvals.jobs.pop(),x=>x.families.enterprise.jobs[0].conclusion='failure',
  x=>x.families['spend-managed'].jobs[0].results.find(v=>v.kind==='MANAGED_CLIENT_APPROVAL_HTTP').ownApprovals=0,
  x=>x.families['security-writes'].jobs[0].results.find(v=>v.family==='BIO-01').trueHigherIdVictimImmutable=false]){
   const changed=clone(r);mutate(changed);assert.throws(()=>verifyRenewalResults(changed));
  }
});
test('a partial or different method receipt cannot be attached to Studio POST',()=>{
 const m=manifest(),row=m.allApiRouteFiles[STUDIO_POST_PATH].methods.find(x=>x.name==='POST');
 for(const mutate of [x=>x.status='GAP',x=>x.testedBy.cohort.pop(),x=>x.testedBy.providerCalled=true,x=>x.testedBy.receiptFile=RENEWAL_FILE,x=>x.testedBy.ownPositiveLine=1]){
  const changed=clone(m),target=changed.allApiRouteFiles[STUDIO_POST_PATH].methods.find(x=>x.name==='POST');mutate(target);assert.throws(()=>verifyStudioPostCredit(changed));
 }
 assert.equal(row.testedBy.providerCalled,false);
});
