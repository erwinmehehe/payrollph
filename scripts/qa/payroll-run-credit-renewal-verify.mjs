import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {verifyPayrollRenewalResults,PAYROLL_RENEWAL_COHORTS} from './payroll-run-credit-renewal-contract.mjs';
import {renewalBlob} from './payroll-run-renewal-inputs.mjs';
import {readHistoricalPayrollRenewal} from './payroll-run-credit-renewal-history.mjs';
import {verifyFreshPayrollRenewal} from './payroll-run-credit-renewal-fresh-contract.mjs';

export const PAYROLL_RENEWAL_RECEIPT='scripts/qa/payroll-run-credit-renewal-fresh-receipt.json';
export const PAYROLL_RENEWAL_SEAL='4d5c0aed6da12760c9fba7e97bbce51bd28af0de09a507943d12ea7783f131a9';
let verifiedCache;
export function readVerifiedPayrollRenewal(read=readFileSync,exists=existsSync,methods=Object.keys(PAYROLL_RENEWAL_COHORTS)){
  const raw=read(PAYROLL_RENEWAL_RECEIPT,'utf8').replaceAll('\r\n','\n');
  assert.equal(createHash('sha256').update(raw).digest('hex'),PAYROLL_RENEWAL_SEAL,'Executed payroll receipts changed');
  const receipt=JSON.parse(raw);verifyPayrollRenewalResults(receipt);
  const historical=readHistoricalPayrollRenewal(read);
  assert.ok(methods.length>0&&new Set(methods).size===methods.length);
  for(const method of methods)assert.ok(Object.hasOwn(PAYROLL_RENEWAL_COHORTS,method),'Method is not renewed');
  const needed=new Set(['boundary',...methods.flatMap(method=>PAYROLL_RENEWAL_COHORTS[method])]);
  // Every current runtime/assertion input byte is a cache key. Custom negative
  // readers never use cached validation, and both old archives remain immutable.
  let fingerprint;
  if(read===readFileSync&&exists===existsSync){
    const hash=createHash('sha256').update(raw).update(historical.raw).update(historical.originalRaw).update(JSON.stringify([...needed].sort()));
    const files=[...new Set([...needed].flatMap(name=>Object.keys(receipt.cohorts[name].sourcePins)))].sort();
    for(const file of files){const bytes=readFileSync(file);hash.update(file+'\0'+bytes.length+'\0').update(bytes);}
    fingerprint=hash.digest('hex');
    if(verifiedCache?.fingerprint===fingerprint)return structuredClone(verifiedCache.receipt);
  }
  verifyFreshPayrollRenewal(receipt,historical.receipt,methods,read,exists);
  if(fingerprint)verifiedCache={fingerprint,receipt:structuredClone(receipt)};
  return receipt;
}

export function payrollRenewalProofBuilder(read=readFileSync,exists=existsSync,methods=Object.keys(PAYROLL_RENEWAL_COHORTS)){
  const receipt=readVerifiedPayrollRenewal(read,exists,methods),verified=new Set(methods);
  return key=>{
    assert.ok(verified.has(key),'Method is not renewed');
    const route='src/app/api/'+key.slice(key.indexOf(' ')+1)+'/route.ts';
    const names=['boundary',...PAYROLL_RENEWAL_COHORTS[key]];
    return {kind:'payroll-run-source-renewal-real-http-pg16',method:key,
      receiptFile:PAYROLL_RENEWAL_RECEIPT,receiptSha256:PAYROLL_RENEWAL_SEAL,
      routeBlobSha:renewalBlob(read(route)),postgresMajor:16,
      cohorts:names.map(name=>{const c=receipt.cohorts[name];return {name,sourceHead:c.sourceHead,runId:c.runId,jobId:c.jobId,evidence:c.evidence};}),
      evidenceLabel:'SOLO_VERIFIED_DEV_RECOVERY',independentlyAccepted:false,
      independentSecurityReview:'PENDING',productionCertified:false};
  };
}
export function payrollRenewalProof(key,read=readFileSync,exists=existsSync){
  return payrollRenewalProofBuilder(read,exists,[key])(key);
}
