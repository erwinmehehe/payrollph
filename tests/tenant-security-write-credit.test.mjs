import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {readSecurityEvidence,verifySecurityCredits,SECURITY_RECEIPT,SECURITY_TARGETS} from '../scripts/qa/tenant-security-write-credit.mjs';
const manifest=()=>JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json','utf8'));
test('three distinct full methods require four source-current executed PG16 cases',()=>{
 assert.equal(verifySecurityCredits(manifest()),3);const r=readSecurityEvidence();
 assert.equal(r.runs['documents-vault'].result.protectedFinalVetoes,2);
 assert.equal(r.runs.developer.result.auditRollbacks,6);assert.equal(r.runs.biometrics.result.ownSessionIngested,2);
 assert.equal(new Set(SECURITY_TARGETS.map(t=>t.path+' '+t.method)).size,3);

});
test('changed receipt and every transitive runtime/proof input fail closed',()=>{
 for(const file of [SECURITY_RECEIPT,...Object.keys(readSecurityEvidence().pins)]){
  const read=(path,...args)=>path===file?Buffer.from('counterfeit'):readFileSync(path,...args);
  assert.throws(()=>verifySecurityCredits(manifest(),read),/receipt changed|source\/proof drift/);
 }
});
test('a partial, borrowed, removed or duplicate method cannot gain credit',()=>{
 for(const t of SECURITY_TARGETS)for(const patch of [{status:'GAP'},{testedBy:{file:t.path}},{reviewedUncertified:{credits:0}}]){
  const m=manifest();Object.assign(m.allApiRouteFiles[t.path].methods.find(x=>x.name===t.method),patch);
  assert.throws(()=>verifySecurityCredits(m));
 }
});
test('actual HTTP mutation check rejected a no-op document validator',()=>{
 const r=readSecurityEvidence();assert.equal(r.mutation.result,'REJECTED');
 const source=readFileSync('scripts/qa/tenant-document-upload-http.mjs','utf8');
 assert.ok(source.includes('assert.throws(()=>assertStoredDocument(result,actor'));
 assert.throws(()=>assert.throws(()=>{},undefined,r.mutation.message),/accepts another employer's data/);
});
