/** Inspected execution evidence; grants no classification or coverage credit. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {collectFreshSamlInputs,assertFreshSamlResult} from './tenant-saml-metadata-fresh-inputs.mjs';
export const FRESH_SAML_RECEIPT='scripts/qa/tenant-saml-metadata-fresh-executed-receipt.json';
export const FRESH_SAML_EVIDENCE='https://github.com/erwinmehehe/payrollph/actions/runs/43597028855/job/132453621488';
export function verifyFreshSamlExecution(read=readFileSync){
 const raw=read(FRESH_SAML_RECEIPT);
 assert.equal(createHash('sha256').update(raw).digest('hex'),'07d0dfef13aa9852a6e52aa1f25bd2342bcc1b7349a0dac4692cc11d24ca1c2a','Executed SAML metadata receipt changed');
 const r=JSON.parse(raw);
 assert.deepEqual(Object.keys(r).sort(),['schema','sourceHead','runId','inputs','result'].sort());
 assert.equal(r.schema,'saml-public-metadata-fresh-pg16-v1');assert.equal(r.runId,'43597028855');
 assert.equal(r.sourceHead,'a255404fd8ff712c1564052346963ad89ecaf939');
 assert.equal(r.result.proofHeadSha,r.sourceHead);assertFreshSamlResult(r.result);
 assert.equal(r.result.requests,48);assert.equal(r.result.protectedOrganizationTables,260);
 assert.equal(Object.keys(r.inputs.pins).length,203);assert.equal(r.inputs.sqlInventory.length,152);
 for(const[path,expected]of Object.entries(r.inputs.pins)){
  const bytes=read(path);const blob=createHash('sha1').update('blob '+Buffer.byteLength(bytes)+'\0').update(bytes).digest('hex');
  assert.equal(blob,expected,'SAML metadata executed input drift: '+path);
 }
 assert.deepEqual(collectFreshSamlInputs(),r.inputs,'Executed roots, import graph or SQL inventory changed');
 return r;
}
