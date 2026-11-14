import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {verifySamlPublicClassification,samlPublicClassificationDelta} from '../scripts/qa/tenant-saml-metadata-public-classification-verify.mjs';
import {historicalSamlMetadataView,SAML_PUBLIC_PATH} from '../scripts/qa/tenant-saml-metadata-public-policy.mjs';
import {verifyFreshSamlExecution,FRESH_SAML_RECEIPT} from '../scripts/qa/tenant-saml-metadata-fresh-execution-verify.mjs';
import {collectFreshSamlInputs} from '../scripts/qa/tenant-saml-metadata-fresh-inputs.mjs';
const manifest=()=>JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json'));
test('only the exact approved public GET closes one GAP and adds zero COVERED credits',()=>{
 const m=manifest(),old=historicalSamlMetadataView(m);
 assert.equal(verifySamlPublicClassification(m),1);assert.equal(samlPublicClassificationDelta(old,m),1);
 assert.equal(samlPublicClassificationDelta(m,m),0);
 assert.equal(m.metrics.coveredAfter,old.metrics.coveredAfter);
 assert.equal(m.metrics.publicByDesign,old.metrics.publicByDesign+1);assert.equal(m.metrics.gap,old.metrics.gap-1);
 assert.equal(m.allApiRouteFiles[SAML_PUBLIC_PATH].methods[0].testedBy,null);
 assert.equal(m.allApiRouteFiles['src/app/api/auth/sso/resolve/route.ts'].methods[0].status,'GAP');
});
test('owner approval without executed evidence, source drift or expanded labels fails closed',()=>{
 assert.throws(()=>verifySamlPublicClassification(manifest(),(p,...args)=>p===FRESH_SAML_RECEIPT?Buffer.from('{}'):readFileSync(p,...args)));
 const m=manifest();m.allApiRouteFiles[SAML_PUBLIC_PATH].methods[0].classificationEvidence.coverageCredits=1;
 assert.throws(()=>verifySamlPublicClassification(m));
 assert.throws(()=>verifyFreshSamlExecution(readFileSync,p=>[...readdirSync(p),'9999_unexecuted.sql']),/SQL inventory changed/);
});
test('the complete locked-compiler import graph and every execution root still match',()=>{
 const r=verifyFreshSamlExecution();assert.deepEqual(collectFreshSamlInputs(),r.inputs);
 assert.equal(Object.keys(r.inputs.pins).length,208);
});
