import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {verifyEnterprisePostCredit,ENTERPRISE_POST_PATH} from '../scripts/qa/tenant-enterprise-admin-credit.mjs';
import {assertEnterpriseMutation} from '../scripts/qa/tenant-enterprise-admin-state.mjs';
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
test('exact executed GitHub PG16 proof and 199 source pins renew only one provisional method',()=>{
 assert.equal(verifyEnterprisePostCredit(manifest),1);const m=manifest.allApiRouteFiles[ENTERPRISE_POST_PATH].methods.find(x=>x.name==='POST');
 assert.equal(m.testedBy.label,'SOLO_VERIFIED_DEV_RECOVERY');assert.equal(m.testedBy.productionTested,false);
 assert.equal(m.testedBy.workflowRunId,42489689534);assert.equal(m.testedBy.workflowJobId,128759143344);
 assert.equal(m.testedBy.verifiedPrHeadSha,'79bc9cd062e76af102c63fe0263a7b75ffad9e65');
 assert.equal(m.testedBy.independentSecurityReview,'PENDING');
 assert.equal(m.testedBy.execution,'github-actions-http-pg16');
});
test('credit rejects counterfeit receipts, partial method metadata and changed proof/runtime inputs',()=>{
 for(const path of ['scripts/qa/tenant-enterprise-admin-credit-receipt.json','scripts/qa/tenant-enterprise-admin-state.mjs','scripts/qa/tenant-enterprise-admin-http.mjs','src/app/api/enterprise/route.ts','src/lib/auth.ts','src/db/schema.ts']){
  assert.throws(()=>verifyEnterprisePostCredit(manifest,(file,encoding)=>file===path?readFileSync(file,encoding)+'\n':readFileSync(file,encoding)),path);
 }
 for(const mutate of [m=>{m.testedBy.scope='One action only';},m=>{m.testedBy.productionTested=true;},m=>{m.testedBy.verifiedPrHeadSha='a'.repeat(40);},m=>{m.status='GAP';},m=>{m.reviewedUncertified={coverageCredits:0};}]){
  const changed=structuredClone(manifest),method=changed.allApiRouteFiles[ENTERPRISE_POST_PATH].methods.find(x=>x.name==='POST');mutate(method);assert.throws(()=>verifyEnterprisePostCredit(changed));
 }
});
