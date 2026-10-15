import test from 'node:test';
import assert from 'node:assert/strict';
import {makeBlankLedger, evaluate, STAGES, CROSS_TENANT} from '../scripts/qa/issue-853-evidence-ledger.mjs';

test('blank journey cannot pass and includes exactly 18 staged plus 9 shared checks',()=>{
  const ledger=makeBlankLedger();
  assert.equal(STAGES.length,9);
  assert.equal(CROSS_TENANT.length,9);
  assert.equal(ledger.tests.length,27);
  assert.equal(new Set(ledger.tests.map(x=>x.id)).size,27);
  assert.deepEqual(ledger.tests.filter(x=>x.tenant==='A').map(x=>x.id),STAGES.map(x=>'A_'+x[0]));
  assert.deepEqual(ledger.tests.filter(x=>x.tenant==='B').map(x=>x.id),STAGES.map(x=>'B_'+x[0]));
  const report=evaluate(ledger);
  assert.equal(report.verdict,'NOT_READY');
  assert.equal(report.passed,0);
  assert.equal(report.blocked,27);
});

test('cannot bypass tenant, reviewer, device, or payout requirements with PASS labels',()=>{
  const ledger=makeBlankLedger();
  for (const row of ledger.tests)row.observedStatus='PASS';
  const report=evaluate(ledger);
  assert.equal(report.verdict,'NOT_READY');
  assert.equal(report.passed,27);
  assert.ok(report.problems.some(s=>s.includes('distinct reviewer')));
  ledger.flags.livePayouts=true;
  assert.ok(evaluate(ledger).problems.some(s=>s.includes('livePayouts')));
  ledger.tests.pop();
  assert.ok(evaluate(ledger).problems.some(s=>s.includes('missing or duplicated')));
});

function prepareClaimedCompletion(){
  const ledger=makeBlankLedger(),sha='a'.repeat(40);
  ledger.sourceSha=sha;ledger.deployedSha=sha;
  ledger.developmentUrl='https://development.example.invalid';
  ledger.databaseClassification='FICTIONAL_ONLY';
  ledger.manilaPayPeriod='2026-10-01/2026-10-15';
  ledger.flags={livePayouts:false,governmentSubmission:false,realEmployeeData:false};
  ledger.runtimeVerification={verifiedAtUtc:'2026-10-14T09:00:00Z',
    deployedBuildRef:'private://evidence-853/runtime-build',
    databaseIsolationRef:'private://evidence-853/runtime-db',
    payoutAndFilingConfigRef:'private://evidence-853/runtime-flags',
    fixtureVersionRef:'private://evidence-853/runtime-fixture'};
  ledger.deviceModel='Test Android handset (manual claim)';
  ledger.browserVersion='Mobile Chrome test-version';
  ledger.identities={ownerBothId:'ownerAB',payrollOfficerAId:'payrollA',payrollOfficerBId:'payrollB',checkerBothId:'checkerAB',employeeAId:'empA',employeeBId:'empB'};
  for(const row of ledger.tests){
    row.observedStatus='PASS';
    row.observedAtUtc='2026-10-14T10:00:00Z';
    row.observedBy=({
      A_CLOCK_IN:'empA',B_CLOCK_IN:'empB',
      A_RUN_PAYROLL:'payrollA',B_RUN_PAYROLL:'payrollB',
      A_REVIEW:'checkerAB',B_REVIEW:'checkerAB',
      A_RELEASE_RECORDS:'ownerAB',B_RELEASE_RECORDS:'ownerAB',
      A_FILING_EVIDENCE:'payrollA',B_FILING_EVIDENCE:'payrollB',
      SWITCH_375:'ownerAB',SWITCH_390:'ownerAB',
      PAYROLL_A_DENIED_B:'payrollA',EMPLOYEE_A_DENIED_B:'empA'
    })[row.id] || 'operator-A';
    row.evidenceRef='private://evidence-853/'+row.id;
    row.independentReviewer='reviewer-B';
  }
  ledger.signoff={independentReviewerId:'reviewer-B',signedAtUtc:'2026-10-14T12:00:00Z',privateEvidenceRef:'private://evidence-853/signoff'};
  return ledger;
}

test('all claims must still be labeled self-reported rather than certified human acceptance',()=>{
  const l=prepareClaimedCompletion(),result=evaluate(l);
  assert.equal(result.verdict,'SELF_REPORTED_COMPLETE_REQUIRES_EXTERNAL_VERIFICATION');
  assert.equal(result.total,27);
  assert.equal(result.passed,27);
  assert.equal(result.problems.length,0);
  l.deployedSha='b'.repeat(40);
  assert.equal(evaluate(l).verdict,'NOT_READY');
  l.deployedSha=l.sourceSha;
  l.tests[5].independentReviewer=l.tests[5].observedBy;
  assert.equal(evaluate(l).verdict,'NOT_READY');
  l.tests[5].independentReviewer='reviewer-B';
  l.tests[4].evidenceRef='https://public.example.net/employee/ssn';
  assert.equal(evaluate(l).verdict,'NOT_READY');
});

test('unknown, duplicated and weakened expected cases cannot pass',()=>{
  const l=prepareClaimedCompletion();
  l.tests[0].expected='Any employee is allowed';
  assert.equal(evaluate(l).verdict,'NOT_READY');
  l.tests[0].expected=STAGES[0][2];
  l.tests[1].id=l.tests[0].id;
  assert.equal(evaluate(l).verdict,'NOT_READY');
  l.tests[1].id='A_ONBOARD';
  l.tests[0].observedStatus='FAIL';
  l.tests[0].defectRef='private-ticket-853-01';
  assert.equal(evaluate(l).verdict,'NOT_READY');
});

test('v2 refuses future timestamps, reused proof, unverified safety and wrong operator',()=>{
  const l=prepareClaimedCompletion();
  assert.equal(evaluate(l).verdict,'SELF_REPORTED_COMPLETE_REQUIRES_EXTERNAL_VERIFICATION');
  l.runtimeVerification.verifiedAtUtc='2099-10-14T09:00:00Z';
  assert.equal(evaluate(l).verdict,'NOT_READY');
  l.runtimeVerification.verifiedAtUtc='2026-10-14T09:00:00Z';
  l.tests[0].evidenceRef=l.tests[1].evidenceRef;
  assert.equal(evaluate(l).verdict,'NOT_READY');
  l.tests[0].evidenceRef='private://evidence-853/A_HIRE';
  l.flags.livePayouts=null;
  assert.equal(evaluate(l).verdict,'NOT_READY');
  l.flags.livePayouts=false;
  const employee=l.tests.find(x=>x.id==='A_CLOCK_IN');
  employee.observedBy='payrollA';
  assert.equal(evaluate(l).verdict,'NOT_READY');
  employee.observedBy='empA';
  l.signoff.independentReviewerId='ownerAB';
  assert.equal(evaluate(l).verdict,'NOT_READY');
});
test('blank v2 leaves deployed safety unverified and cannot pass',()=>{
  const l=makeBlankLedger();
  assert.equal(l.schema,'payrollph-issue853-human-acceptance-v2');
  assert.equal(l.flags.livePayouts,null);
  assert.equal(l.flags.governmentSubmission,null);
  assert.equal(l.flags.realEmployeeData,null);
  assert.equal(l.runtimeVerification.verifiedAtUtc,'');
  assert.equal(evaluate(l).verdict,'NOT_READY');
});
