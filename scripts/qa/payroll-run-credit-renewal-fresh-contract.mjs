import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {PAYROLL_RENEWAL_COHORTS,verifyPayrollRenewalResults} from './payroll-run-credit-renewal-contract.mjs';
import {collectRenewalInputs,RENEWAL_LEDGER_INPUTS} from './payroll-run-renewal-inputs.mjs';
import {HISTORICAL_RENEWAL_RECEIPT,HISTORICAL_RENEWAL_SEAL} from './payroll-run-credit-renewal-history.mjs';

/** Called only after the fresh receipt seal and both historical archives verify. */
export function verifyFreshPayrollRenewal(receipt,historical,methods,read=readFileSync,exists=existsSync){
  verifyPayrollRenewalResults(receipt);
  assert.deepEqual(receipt.historicalReconciledReceipt,{file:HISTORICAL_RENEWAL_RECEIPT,sha256:HISTORICAL_RENEWAL_SEAL});
  assert.deepEqual(receipt.methods,historical.methods);
  assert.deepEqual(receipt.accountingScope,historical.accountingScope);
  assert.deepEqual(receipt.accountingScope.excludedEntryPoints,RENEWAL_LEDGER_INPUTS);
  assert.ok(methods.length>0&&new Set(methods).size===methods.length);
  for(const method of methods)assert.ok(Object.hasOwn(PAYROLL_RENEWAL_COHORTS,method),'Method is not renewed');
  const needed=new Set(['boundary',...methods.flatMap(method=>PAYROLL_RENEWAL_COHORTS[method])]);
  assert.deepEqual(Object.keys(receipt.cohorts),Object.keys(historical.cohorts));
  for(const [name,cohort]of Object.entries(receipt.cohorts)){
    const old=historical.cohorts[name];
    assert.deepEqual(cohort.historicalExecution,{sourceHead:old.sourceHead,runId:old.runId,jobId:old.jobId},
      'A fresh execution must retain its distinct historical job identity');
    assert.notEqual(cohort.jobId,old.jobId,'Old jobs cannot execute changed input');
    const workflow=name==='actions'?'.github/workflows/payroll-run-credit-renewal.yml':old.workflow;
    assert.equal(cohort.workflow,workflow);
    const additional=name==='paymongo'?['scripts/qa/paymongo-http-proof-preload.mjs']:[];
    assert.deepEqual(cohort.roots,[...new Set([...old.roots,workflow,...additional])],
      'Fresh execution may not drop a runtime, assertion, baseline or workflow root');
    assert.equal(cohort.evidence,'https://github.com/erwinmehehe/payrollph/actions/runs/'+cohort.runId+'/job/'+cohort.jobId);
    assert.deepEqual(Object.keys(cohort.executedAccountingInputs),Object.keys(old.executedAccountingInputs));
    for(const sha of Object.values(cohort.executedAccountingInputs))assert.match(sha,/^[a-f0-9]{40}$/);
    if(needed.has(name))assert.deepEqual(collectRenewalInputs(cohort.roots,read,exists,true),cohort.sourcePins,
      'Executed input closure drift: '+name);
  }
  return receipt;
}
