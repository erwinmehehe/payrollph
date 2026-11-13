import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {verifyPayrollRenewalResults,PAYROLL_RENEWAL_COHORTS} from './payroll-run-credit-renewal-contract.mjs';
import {collectRenewalInputs,renewalBlob,RENEWAL_LEDGER_INPUTS} from './payroll-run-renewal-inputs.mjs';

export const PAYROLL_RENEWAL_RECEIPT='scripts/qa/payroll-run-credit-renewal-reconciled-receipt.json';
export const PAYROLL_RENEWAL_SEAL='833c31caba56cbf082108a6fdd8a37219b11346e40b319d72c66ca27ba6054a6';
let verifiedCache;
export function readVerifiedPayrollRenewal(read=readFileSync,exists=existsSync,methods=Object.keys(PAYROLL_RENEWAL_COHORTS)){
  const raw=read(PAYROLL_RENEWAL_RECEIPT,'utf8').replaceAll('\r\n','\n');
  assert.equal(createHash('sha256').update(raw).digest('hex'),PAYROLL_RENEWAL_SEAL,'Executed payroll receipts changed');
  const receipt=JSON.parse(raw);verifyPayrollRenewalResults(receipt);
  assert.ok(methods.length>0&&new Set(methods).size===methods.length);
  for(const method of methods)assert.ok(Object.hasOwn(PAYROLL_RENEWAL_COHORTS,method),'Method is not renewed');
  const needed=new Set(['boundary',...methods.flatMap(method=>PAYROLL_RENEWAL_COHORTS[method])]);
  const historical=receipt.historicalFullInputReceipt;
  assert.deepEqual(historical,{file:'scripts/qa/payroll-run-credit-renewal-receipt.json',
    sha256:'13938f06233b272e72bcaf4f171378de220942b18cfffc79d8e8088d62a6e35b'});
  const oldRaw=read(historical.file,'utf8').replaceAll('\r\n','\n');
  assert.equal(createHash('sha256').update(oldRaw).digest('hex'),historical.sha256,'Historical full input receipt changed');
  const original=JSON.parse(oldRaw);
  // Repeated ledger guards must not reparse the same nine module graphs. The
  // cache is keyed by BOTH sealed receipts and every current execution-matched
  // input byte, not by timestamps or candidate manifest contents. Custom readers
  // always take the uncached validation path (including negative mutation tests).
  let fingerprint;
  if(read===readFileSync&&exists===existsSync){
    const hash=createHash('sha256').update(raw).update(oldRaw).update(JSON.stringify([...needed].sort()));
    const files=[...new Set([...needed].flatMap(name=>Object.keys(receipt.cohorts[name].sourcePins)))].sort();
    for(const file of files){const bytes=readFileSync(file);hash.update(file+'\0'+bytes.length+'\0').update(bytes);}
    fingerprint=hash.digest('hex');
    if(verifiedCache?.fingerprint===fingerprint)return structuredClone(verifiedCache.receipt);
  }
  assert.deepEqual(receipt.methods,original.methods);
  assert.deepEqual(receipt.accountingScope.excludedEntryPoints,RENEWAL_LEDGER_INPUTS);
  const routeRoots=[...new Set(receipt.methods.map(key=>'src/app/api/'+key.slice(key.indexOf(' ')+1)+'/route.ts'))];
  for(const [name,cohort]of Object.entries(receipt.cohorts)){
    const old=original.cohorts[name];assert.ok(old);
    const {sourcePins,executedAccountingInputs,...metadata}=cohort;
    const {sourcePins:oldPins,...oldMetadata}=old;
    assert.deepEqual(metadata,oldMetadata,'Executed job/result metadata must remain immutable');
    assert.deepEqual(executedAccountingInputs,Object.fromEntries(Object.entries(oldPins).filter(([p])=>RENEWAL_LEDGER_INPUTS.includes(p))));
    assert.deepEqual(sourcePins,Object.fromEntries(Object.entries(oldPins).filter(([p])=>!RENEWAL_LEDGER_INPUTS.includes(p))),
      'Only the five explicitly reviewed bookkeeping inputs can be separated; no runtime or HTTP assertion can be omitted');
    assert.equal(cohort.evidence,'https://github.com/erwinmehehe/payrollph/actions/runs/'+cohort.runId+'/job/'+cohort.jobId);
    assert.ok(routeRoots.every(file=>cohort.roots.includes(file)),'Every changed route must remain in the executed closure');
    assert.ok(cohort.roots.includes(cohort.workflow));
    if(needed.has(name))assert.deepEqual(collectRenewalInputs(cohort.roots,read,exists,true),cohort.sourcePins,'Executed input closure drift: '+name);
  }
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
