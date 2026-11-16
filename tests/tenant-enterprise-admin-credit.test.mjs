import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {verifyEnterprisePostCredit,ENTERPRISE_POST_PATH} from '../scripts/qa/tenant-enterprise-admin-credit.mjs';
import {assertEnterpriseMutation} from '../scripts/qa/tenant-enterprise-admin-state.mjs';
import {verifyAllSealedWageHolds,SEALED_WAGE_HOLD_KIND} from '../scripts/qa/wage-registry-sealed-receipt-source-hold.mjs';
const manifest=JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json','utf8'));
test('the actual HTTP-loop discriminator fails if its write oracle is replaced by a no-op',()=>{
 const before={organization_security_policies:[]};
 const payload={organizationId:401,action:'save-security-policy',sessionIdleMinutes:90,sessionMaxHours:24,maxActiveSessions:10,requireMfa:true,ssoMode:'optional'};
 const after={organization_security_policies:[{row:{organization_id:401,updated_by_user_id:501,session_idle_minutes:90,session_max_hours:24,max_active_sessions:10,require_mfa:true,sso_mode:'optional'}}]};
 assertEnterpriseMutation(before,after,payload,{},501);
 const line=readFileSync('scripts/qa/tenant-enterprise-admin-http.mjs','utf8').split('\n').find(x=>x.includes('write validator accepts another employer'));
 assert.ok(line.includes("assert.throws(()=>assertEnterpriseMutation(before,after,{...payload,organizationId:victim.org.id},value,victim.owner.id),undefined,"),'HTTP proof must execute the discriminator assertion');
 const check=oracle=>assert.throws(()=>oracle(before,after,{...payload,organizationId:902},{},903),undefined,"write validator accepts another employer's data");
 check(assertEnterpriseMutation);
 assert.throws(()=>check(()=>{}),/accepts another employer/);
 assert.throws(()=>assertEnterpriseMutation(before,{...before,audit_events:[{row:{action:'only audit'}}]},payload,{},501),/business state must change/);
});
test('exact 199-input enterprise receipt is historical only after wage source withdrawal',()=>{
 const held=verifyAllSealedWageHolds(manifest);
 const key='POST '+ENTERPRISE_POST_PATH;
 assert.ok(held.has(key));
 const method=manifest.allApiRouteFiles[ENTERPRISE_POST_PATH].methods.find(x=>x.name==='POST');
 assert.equal(method.status,'GAP');
 assert.equal(method.testedBy,null);
 assert.equal(method.reviewedUncertified?.kind,SEALED_WAGE_HOLD_KIND);
 assert.equal(method.reviewedUncertified.coverageCredits,0);
 const original=method.reviewedUncertified.priorProof;
 assert.equal(original.label,'SOLO_VERIFIED_DEV_RECOVERY');
 assert.equal(original.productionTested,false);
 assert.equal(original.workflowRunId,42489689534);
 assert.equal(original.workflowJobId,128759143344);
 assert.equal(original.verifiedPrHeadSha,'79bc9cd062e76af102c63fe0263a7b75ffad9e65');
 assert.equal(original.independentSecurityReview,'PENDING');
 assert.equal(original.execution,'github-actions-http-pg16');
 assert.throws(()=>verifyEnterprisePostCredit(manifest),
   'The full-input enterprise verifier may not accept a different wage source');
});
test('tampered enterprise withdrawal, seal, or receipt fails closed',()=>{
 const key=ENTERPRISE_POST_PATH;
 for(const mutate of [
  x=>{x.status='COVERED';},
  x=>{x.testedBy=x.reviewedUncertified.priorProof;},
  x=>{x.reviewedUncertified.coverageCredits=1;},
  x=>{x.reviewedUncertified.priorProof={file:'borrowed.mjs'};},
  x=>{x.reviewedUncertified.productionCertified=true;},
 ]){
   const changed=structuredClone(manifest),method=changed.allApiRouteFiles[key].methods.find(x=>x.name==='POST');
   mutate(method);
   assert.throws(()=>verifyAllSealedWageHolds(changed));
 }
 for(const target of ['scripts/qa/tenant-enterprise-admin-credit-receipt.json',
    'src/lib/wage-orders.ts','src/lib/statutory-rule-watch.ts']){
   assert.throws(()=>verifyAllSealedWageHolds(manifest,p=>{
     const v=readFileSync(p);
     return p===target?Buffer.concat([v,Buffer.from('\nchanged')]):v;
   }),target+': only exact source and original receipt remain acceptable');
 }
});
