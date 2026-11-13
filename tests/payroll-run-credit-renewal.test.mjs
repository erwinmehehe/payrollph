import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {load} from 'js-yaml';
import {assertHistoricalHttpWorkflowCheckout} from '../scripts/qa/payroll-run-credit-renewal-workflow-compat.mjs';
import {verifyPayrollRenewalResults,PAYROLL_RENEWAL_METHODS} from '../scripts/qa/payroll-run-credit-renewal-contract.mjs';
import {readVerifiedPayrollRenewal,PAYROLL_RENEWAL_RECEIPT,payrollRenewalProof} from '../scripts/qa/payroll-run-credit-renewal-verify.mjs';
const receipt=()=>JSON.parse(readFileSync(PAYROLL_RENEWAL_RECEIPT,'utf8'));

test('fresh HTTP reproof checks out the exact proposed head with no persisted credentials',()=>{
  const workflow=load(readFileSync('.github/workflows/security-http-smoke.yml','utf8'));
  const steps=workflow.jobs['security-http-acceptance'].steps;
  assert.match(steps[0].uses,/^actions\/checkout@[a-f0-9]{40}$/);
  assert.deepEqual(steps[0].with,{'persist-credentials':false,ref:'${{ github.event.pull_request.head.sha || github.sha }}'});
  assert.equal(steps[1].env.EXPECTED_SOURCE_SHA,'${{ github.event.pull_request.head.sha || github.sha }}');
  assert.equal(steps[1].run,'test "$(git rev-parse HEAD)" = "$EXPECTED_SOURCE_SHA"');
});
test('historical unaccepted page evidence permits only the source-sealed checkout change',()=>{
  const file='.github/workflows/security-http-smoke.yml',expected='cca392e383c9f24b3ab6d3ec0e5b0de5a6be2736';
  assert.equal(assertHistoricalHttpWorkflowCheckout(file,expected),true);
  assert.throws(()=>assertHistoricalHttpWorkflowCheckout(file,'0'.repeat(40)));
  assert.throws(()=>assertHistoricalHttpWorkflowCheckout(file,expected,(p,...args)=>readFileSync(p,...args)+'\n# unreviewed change'));
});

test('historical nine-cohort counters cover nineteen methods; changed shared accounting runner requires a fresh PG16 execution',()=>{
  assert.deepEqual([...verifyPayrollRenewalResults(receipt())],PAYROLL_RENEWAL_METHODS);
  assert.throws(()=>readVerifiedPayrollRenewal(),/Executed input closure drift: secondPass/);
  assert.equal(readVerifiedPayrollRenewal(readFileSync,undefined,['POST payroll-runs']).methods.length,19);
});
test('failed, borrowed, wrong-source, missing or production-accepted cohorts earn no renewal',()=>{
  for(const mutate of [
    r=>{delete r.cohorts.boundary;},r=>{delete r.cohorts.moneyOn;},
    r=>{r.cohorts.creation.conclusion='queued';},
    r=>{r.cohorts.moneyOn.jobId=r.cohorts.moneyOff.jobId;},
    r=>{r.cohorts.creation.sourceHead='0'.repeat(40);},
    r=>{r.productionCertified=true;},r=>{r.liveActivation=true;},
    r=>{r.methods.push('POST payroll-runs/[id]/xendit-payout');},
    r=>{r.methods[1]=r.methods[0];},
  ]){const r=receipt();mutate(r);assert.throws(()=>verifyPayrollRenewalResults(r));}
});
test('empty own success, foreign acceptance, altered victim SQL and fake provider isolation fail closed',()=>{
  for(const mutate of [
    r=>{r.cohorts.creation.result.own201=[0,0];},
    r=>{r.cohorts.secondPass.result.highRisk.validOwnPositives=[0,0];},
    r=>{r.cohorts.moneyOff.result.successes=[];},
    r=>{r.cohorts.moneyOn.result.receipts.find(x=>x.label==='foreign run process').status=200;},
    r=>{r.cohorts.exportsPost.result.fullSnapshotsUnchanged=false;},
    r=>{r.cohorts.readTable.result.discriminatingProofs=0;},
    r=>{r.cohorts.actions.result.forgedSelectorsIgnored=false;},
    r=>{r.cohorts.paymongo.result.realProviderContacted=true;},
    r=>{r.cohorts.paymongo.result.successes.find(x=>x.freshRetry).syntheticPosts=2;},
  ]){const r=receipt();mutate(r);assert.throws(()=>verifyPayrollRenewalResults(r));}
});
test('receipt seal rejects invented results and exact executed source drift',()=>{
  assert.throws(()=>readVerifiedPayrollRenewal((file,...args)=>file===PAYROLL_RENEWAL_RECEIPT?
    readFileSync(file,...args)+'\n':readFileSync(file,...args)),/receipts changed/);
  for(const [file,method]of [['src/lib/payroll-run-membership.ts','POST payroll-runs'],['src/lib/auth.ts','POST payroll-runs'],
    ['scripts/qa/tenant-money-lifecycle-http.mjs','POST payroll-runs/[id]/process'],['.github/workflows/payroll-run-credit-renewal.yml','POST payroll-runs']]){
    assert.throws(()=>readVerifiedPayrollRenewal((p,...args)=>p===file?
      Buffer.concat([Buffer.from(readFileSync(p)),Buffer.from('\n// unexecuted edit')]):readFileSync(p,...args),undefined,[method]),
      /closure drift/);
  }
});
test('renewed citations identify actual jobs without pretending independent acceptance',()=>{
  const proof=payrollRenewalProof('POST payroll-runs');
  assert.equal(proof.cohorts.find(x=>x.name==='creation').jobId,131691175894);
  assert.equal(proof.independentlyAccepted,false);assert.equal(proof.productionCertified,false);
  assert.throws(()=>payrollRenewalProof('POST payroll-runs/[id]/xendit-payout'),/not renewed/);
});
