import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {readSecurityEvidence,verifySecurityCredits,SECURITY_RECEIPT,SECURITY_TARGETS} from '../scripts/qa/tenant-security-write-credit.mjs';
import {historicalDocumentSecurityFixture} from './helpers/document-security-fixture.mjs';
const manifest=()=>JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json','utf8'));
test('changed document dependency invalidates all three current credits while preserving the historical PG16 receipt',()=>{
 assert.throws(()=>verifySecurityCredits(manifest()),/Security source\/proof drift/);
 const historical=historicalDocumentSecurityFixture(manifest());
 assert.equal(verifySecurityCredits(historical.manifest,historical.read),3);const r=readSecurityEvidence(historical.read);
 assert.equal(r.runs['documents-vault'].result.protectedFinalVetoes,2);
 assert.equal(r.runs.developer.result.auditRollbacks,6);assert.equal(r.runs.biometrics.result.ownSessionIngested,2);
 assert.equal(new Set(SECURITY_TARGETS.map(t=>t.path+' '+t.method)).size,3);

});
test('changed receipt and every transitive runtime/proof input fail closed',()=>{
 const historical=historicalDocumentSecurityFixture(manifest());
 for(const file of [SECURITY_RECEIPT,...Object.keys(readSecurityEvidence(historical.read).pins)]){
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
 const historical=historicalDocumentSecurityFixture(manifest());
 const r=readSecurityEvidence(historical.read);assert.equal(r.mutation.result,'REJECTED');
 const source=readFileSync('scripts/qa/tenant-document-upload-http.mjs','utf8');
 assert.ok(source.includes('assert.throws(()=>assertStoredDocument(result,actor'));
 assert.throws(()=>assert.throws(()=>{},undefined,r.mutation.message),/accepts another employer's data/);
});
