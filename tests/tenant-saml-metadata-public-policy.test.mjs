import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readSamlOwnerApproval,expectedSamlPublicMethod,verifySamlPublicPolicy,historicalSamlMetadataView,samlPrivacyRead,SAML_PUBLIC_PATH,SAML_OWNER_APPROVAL,SAML_PRIVACY_ARCHIVE} from '../scripts/qa/tenant-saml-metadata-public-policy.mjs';
const manifest=()=>JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json'));
function proposal(){const m=manifest(),r=m.allApiRouteFiles[SAML_PUBLIC_PATH].methods[0];
 if(r.status==='GAP'){m.allApiRouteFiles[SAML_PUBLIC_PATH].methods=[expectedSamlPublicMethod()];m.metrics.publicByDesign++;m.metrics.gap--;
 m.acceptanceStatus=m.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/,'NOT ACCEPTED: '+m.metrics.gap+' API methods');}
 return m;
}
test('the exact owner statement permits one public label, zero COVERED credits and keeps resolve held',()=>{
 const a=readSamlOwnerApproval();assert.equal(a.pullRequest,1981);assert.equal(a.scope.resolveStatus,'GAP');
 assert.equal(a.scope.newCoveredCredits,0);assert.equal(verifySamlPublicPolicy(proposal()),1);
});
test('historical validation restores only metadata GAP without mutating live policy or other methods',()=>{
 const m=proposal(),before=structuredClone(m),old=historicalSamlMetadataView(m);
 assert.deepEqual(m,before);assert.equal(old.metrics.coveredAfter,m.metrics.coveredAfter);
 assert.equal(old.metrics.gap,m.metrics.gap+1);assert.equal(old.metrics.publicByDesign,m.metrics.publicByDesign-1);
 for(const[path,row]of Object.entries(m.allApiRouteFiles))if(path!==SAML_PUBLIC_PATH)assert.deepEqual(old.allApiRouteFiles[path],row);
 assert.equal(old.allApiRouteFiles[SAML_PUBLIC_PATH].methods[0].status,'GAP');
});
test('forged decision, changed archive, route drift, expanded scope and resolve relabel are rejected',()=>{
 for(const path of [SAML_OWNER_APPROVAL,SAML_PRIVACY_ARCHIVE,SAML_PUBLIC_PATH])assert.throws(()=>verifySamlPublicPolicy(proposal(),(p,...args)=>{
  const b=readFileSync(p,...args);return p===path?Buffer.concat([Buffer.from(b),Buffer.from(' changed')]):b;
 }));
 for(const mutate of [m=>{m.allApiRouteFiles[SAML_PUBLIC_PATH].methods[0].status='COVERED';},
  m=>{m.allApiRouteFiles[SAML_PUBLIC_PATH].methods[0].classificationEvidence.coverageCredits=1;},
  m=>{m.allApiRouteFiles[SAML_PUBLIC_PATH].methods.push({name:'POST',status:'PUBLIC-BY-DESIGN'});},
  m=>{m.allApiRouteFiles['src/app/api/auth/sso/resolve/route.ts'].methods[0].status='COVERED';}]){
  const m=proposal();mutate(m);assert.throws(()=>verifySamlPublicPolicy(m));
 }
});
test('historical test adaptation accepts no arbitrary source replacement',()=>{
 const path='tests/tenant-saml-metadata-public.test.mjs';
 assert.throws(()=>samlPrivacyRead((p,...args)=>p===path?readFileSync(p,'utf8')+' changed':readFileSync(p,...args))(path),/source drift/);
});
