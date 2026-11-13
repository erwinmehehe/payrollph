import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {verifyPayrollRenewalResults,PAYROLL_RENEWAL_COHORTS} from './payroll-run-credit-renewal-contract.mjs';
import {collectRenewalInputs,renewalBlob} from './payroll-run-renewal-inputs.mjs';

export const PAYROLL_RENEWAL_RECEIPT='scripts/qa/payroll-run-credit-renewal-receipt.json';
export const PAYROLL_RENEWAL_SEAL='13938f06233b272e72bcaf4f171378de220942b18cfffc79d8e8088d62a6e35b';
export function readVerifiedPayrollRenewal(read=readFileSync,exists=existsSync){
  const raw=read(PAYROLL_RENEWAL_RECEIPT,'utf8').replaceAll('\r\n','\n');
  assert.equal(createHash('sha256').update(raw).digest('hex'),PAYROLL_RENEWAL_SEAL,'Executed payroll receipts changed');
  const receipt=JSON.parse(raw);verifyPayrollRenewalResults(receipt);
  const routeRoots=[...new Set(receipt.methods.map(key=>'src/app/api/'+key.slice(key.indexOf(' ')+1)+'/route.ts'))];
  for(const [name,cohort]of Object.entries(receipt.cohorts)){
    assert.equal(cohort.evidence,'https://github.com/erwinmehehe/payrollph/actions/runs/'+cohort.runId+'/job/'+cohort.jobId);
    assert.ok(routeRoots.every(file=>cohort.roots.includes(file)),'Every changed route must remain in the executed closure');
    assert.ok(cohort.roots.includes(cohort.workflow));
    assert.deepEqual(collectRenewalInputs(cohort.roots,read,exists),cohort.sourcePins,'Executed input closure drift: '+name);
  }
  return receipt;
}

export function payrollRenewalProof(key,read=readFileSync,exists=existsSync){
  const receipt=readVerifiedPayrollRenewal(read,exists);assert.ok(receipt.methods.includes(key),'Method is not renewed');
  const route='src/app/api/'+key.slice(key.indexOf(' ')+1)+'/route.ts';
  const names=['boundary',...PAYROLL_RENEWAL_COHORTS[key]];
  return {kind:'payroll-run-source-renewal-real-http-pg16',method:key,
    receiptFile:PAYROLL_RENEWAL_RECEIPT,receiptSha256:PAYROLL_RENEWAL_SEAL,
    routeBlobSha:renewalBlob(read(route)),postgresMajor:16,
    cohorts:names.map(name=>{const c=receipt.cohorts[name];return {name,sourceHead:c.sourceHead,runId:c.runId,jobId:c.jobId,evidence:c.evidence};}),
    evidenceLabel:'SOLO_VERIFIED_DEV_RECOVERY',independentlyAccepted:false,
    independentSecurityReview:'PENDING',productionCertified:false};
}
