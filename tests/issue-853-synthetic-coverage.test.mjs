import assert from 'node:assert/strict';
import test from 'node:test';
import {buildIssue853SyntheticScope} from '../scripts/qa/issue-853-synthetic-coverage.mjs';

const sha='1'.repeat(40);
const stages=['Hire','Onboard','Schedule','Clock In','Approve Time','Run Payroll',
  'Review','Release Payroll Records','Prepare Filing Evidence'];
function receipt(){
  return {
    connected:{
      sourceSha:sha,result:'PASS',scope:'synthetic-local-postgres18-only',
      independentHumanUat:'NOT_RUN',realEmployerReconciliation:'NOT_RUN',
      bankOrPaymentSubmission:'PROHIBITED',officialAgencySubmission:'NOT_RUN',
      stages:stages.map(name=>({name,status:'PASS'})),
      employerBStages:stages.map(name=>({name,status:'PASS'})),
      lineage:{organizationId:11,shadowOrganizationId:12,employeeId:14,employerBWorkerId:15,
        separateEmployerSameLocalEmployeeNo:true,sourcePunchId:21,payrollRunId:22,
        draftHashes:Object.fromEntries(['BIR','SSS','PhilHealth','Pag-IBIG'].map(x=>[x,'a'.repeat(64)])),
        employerB:{organizationId:12,employeeId:15,sourcePunchId:23,payrollRunId:24,
          periodStart:'2026-10-31',periodEnd:'2026-10-31',payDate:'2026-11-01',
          draftHashes:Object.fromEntries(['BIR','SSS','PhilHealth','Pag-IBIG'].map(x=>[x,'b'.repeat(64)]))},
        periodStart:'2026-10-31',periodEnd:'2026-10-31',payDate:'2026-11-01'},
      negativeControls:[
        'tenant B-only owner denied A employees','tenant A payroll officer denied B payroll',
        'tenant B cannot inspect the released tenant A payroll',
        'payroll maker cannot approve checker task','duplicate record release rejected',
        'tenant B-only payroll officer denied A payroll',
        'tenant A HR cannot read B onboarding','tenant A HR denied B roster',
        'B employee cannot approve own attendance','A-only payroll cannot read B calculated register',
        'B payroll maker cannot self-approve','B checker cannot release payroll records',
        'duplicate B record release denied','B-only owner cannot read A released payroll',
        'BIR A payroll denied B draft'
      ]
    },
    mobile:{sourceSha:sha,result:'PASS',independentHumanUat:false,widths:[1440,375,390],checks:[
      ...[375,390].flatMap(width=>[
        width+'px failure/retry and owner switch A -> B -> A; disjoint tenant employee records',
        width+'px verified employee session and cross-tenant 403'
      ])
    ]}
  };
}

test('two employers require source-connected 9+9 while independent human remains 0/27',()=>{
  const {connected,mobile}=receipt();
  const output=buildIssue853SyntheticScope(connected,mobile,sha);
  assert.equal(output.result,'SYNTHETIC_SCOPE_PASS_NOT_INDEPENDENT_UAT');
  assert.equal(output.employerCount,2);
  assert.equal(output.fullyAutomatedEmployerJourneys,2);
  assert.equal(output.employerA.automatedStagesPassed,9);
  assert.equal(output.employerB.automatedStagesPassed,9);
  assert.equal(output.humanObservation.total,27);
  assert.equal(output.humanObservation.passed,0);
  assert.equal(output.releaseAuthorization,'NO_GO');
  assert.ok(!JSON.stringify(output).includes('organizationId'));
  assert.ok(!JSON.stringify(output).includes('sourcePunchId'));
  assert.ok(!JSON.stringify(output).includes('draftHashes'));
});

test('missing tenant denial, wrong identity, payout or manual-UAT claim fails closed',()=>{
  let {connected,mobile}=receipt();
  connected.negativeControls=connected.negativeControls.slice(1);
  assert.throws(()=>buildIssue853SyntheticScope(connected,mobile,sha));
  ({connected,mobile}=receipt());
  connected.lineage.shadowOrganizationId=connected.lineage.organizationId;
  assert.throws(()=>buildIssue853SyntheticScope(connected,mobile,sha));
  ({connected,mobile}=receipt());
  connected.bankOrPaymentSubmission='DONE';
  assert.throws(()=>buildIssue853SyntheticScope(connected,mobile,sha));
  ({connected,mobile}=receipt());
  mobile.independentHumanUat=true;
  assert.throws(()=>buildIssue853SyntheticScope(connected,mobile,sha));
});

test('missing 375 or 390 authenticated denial and mismatched SHA fails closed',()=>{
  let {connected,mobile}=receipt();
  mobile.checks=mobile.checks.filter(x=>!x.includes('390px verified'));
  assert.throws(()=>buildIssue853SyntheticScope(connected,mobile,sha));
  ({connected,mobile}=receipt());
  mobile.sourceSha='2'.repeat(40);
  assert.throws(()=>buildIssue853SyntheticScope(connected,mobile,sha));
  ({connected,mobile}=receipt());
  connected.stages[7].status='BLOCKED';
  assert.throws(()=>buildIssue853SyntheticScope(connected,mobile,sha));
});

test('B cannot be a shadow, duplicate A worker, reuse A payroll or skip filing',()=>{
  let {connected,mobile}=receipt();
  delete connected.employerBStages;
  assert.throws(()=>buildIssue853SyntheticScope(connected,mobile,sha));
  ({connected,mobile}=receipt());
  connected.employerBStages[5].status='NOT_RUN';
  assert.throws(()=>buildIssue853SyntheticScope(connected,mobile,sha));
  ({connected,mobile}=receipt());
  connected.lineage.employerB.employeeId=connected.lineage.employeeId;
  assert.throws(()=>buildIssue853SyntheticScope(connected,mobile,sha));
  ({connected,mobile}=receipt());
  connected.lineage.employerB.payrollRunId=connected.lineage.payrollRunId;
  assert.throws(()=>buildIssue853SyntheticScope(connected,mobile,sha));
  ({connected,mobile}=receipt());
  connected.lineage.employerB.draftHashes.PagIbig=null;
  assert.throws(()=>buildIssue853SyntheticScope(connected,mobile,sha));
  ({connected,mobile}=receipt());
  connected.negativeControls=connected.negativeControls.filter(x=>!x.includes('B payroll maker cannot self-approve'));
  assert.throws(()=>buildIssue853SyntheticScope(connected,mobile,sha));
});
