/** Inspected execution evidence; grants no classification or coverage credit. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {collectFreshSamlInputs,assertFreshSamlResult} from './tenant-saml-metadata-fresh-inputs.mjs';
import {samlExecutedInputRead} from './tenant-saml-adapted-inputs.mjs';
import {collectRenewalInputs} from './payroll-run-renewal-inputs.mjs';
export const FRESH_SAML_RECEIPT='scripts/qa/tenant-saml-metadata-fresh-executed-receipt.json';
export const FRESH_SAML_EVIDENCE='https://github.com/erwinmehehe/payrollph/actions/runs/43603213932/job/132472217596';
export function verifyFreshSamlExecution(rawRead=readFileSync,list=readdirSync){
 const read=samlExecutedInputRead(rawRead);
 assert.equal(createHash('sha256').update(read('scripts/qa/tenant-saml-metadata-initial-executed-receipt.json')).digest('hex'),
  '07d0dfef13aa9852a6e52aa1f25bd2342bcc1b7349a0dac4692cc11d24ca1c2a','Initial executed SAML receipt changed');
 assert.equal(createHash('sha256').update(read('scripts/qa/tenant-saml-metadata-before-tempfix-executed-receipt.json')).digest('hex'),
  'f1eaed5965db7ef722f33f4b0d692071159fa5494a41e1f047f794eaf4f48aec','Pre-security-fix executed SAML receipt changed');
 const raw=read(FRESH_SAML_RECEIPT);
 assert.equal(createHash('sha256').update(raw).digest('hex'),'1cb32979074b7c71d1fd0cb4e1c49ffd8dc1a0bd564f34ec7671167a860914de','Executed SAML metadata receipt changed');
 const r=JSON.parse(raw);
 assert.deepEqual(Object.keys(r).sort(),['schema','sourceHead','runId','inputs','result'].sort());
 assert.equal(r.schema,'saml-public-metadata-fresh-pg16-v1');assert.equal(r.runId,'43603213932');
 assert.equal(r.sourceHead,'b951f2de1bb15f0694a8699ea531e7937db82661');
 assert.equal(r.result.proofHeadSha,r.sourceHead);assertFreshSamlResult(r.result);
 assert.equal(r.result.requests,48);assert.equal(r.result.protectedOrganizationTables,260);
 assert.equal(Object.keys(r.inputs.pins).length,210);assert.equal(r.inputs.sqlInventory.length,152);
 for(const[path,expected]of Object.entries(r.inputs.pins)){
  const bytes=read(path);const blob=createHash('sha1').update('blob '+Buffer.byteLength(bytes)+'\0').update(bytes).digest('hex');
  assert.equal(blob,expected,'SAML metadata executed input drift: '+path);
 }
 // Roots and SQL inventory come from the sealed collector; every pin is re-read through the reviewed-adapter map.
 const current=collectFreshSamlInputs();
 assert.deepEqual({...current,pins:collectRenewalInputs(current.roots,read)},r.inputs,'Executed roots, import graph or SQL inventory changed');
 // Also exercise the SQL catalog independently so an injected/additional file
 // can never inherit a previously executed baseline.
 assert.deepEqual(list('drizzle').filter(p=>/^\d{4}_.+\.sql$/.test(p)).sort().map(p=>'drizzle/'+p),
  r.inputs.sqlInventory,'Executed SQL inventory changed');
 return r;
}
