import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, readFile, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {makeBlankLedger, evaluate, STAGES, CROSS_TENANT} from '../scripts/qa/issue-853-evidence-ledger.mjs';
import { symlinkSkip } from './helpers/symlink-capability.mjs';

const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const script=join(repoRoot,'scripts/qa/issue-853-evidence-ledger.mjs');
const ago=hours=>new Date(Date.now()-hours*3600_000).toISOString();

function claimedCompletion() {
  // Fictional, deliberately self-reported fixture only; never an authenticated human witness.
  const ledger=makeBlankLedger();
  ledger.createdUtc=ago(6); // Fictional historical test session precedes every claimed action.
  const sha='a'.repeat(40);
  ledger.sourceSha=sha;
  ledger.deployedSha=sha;
  ledger.developmentUrl='https://fictional-qa.example.invalid';
  ledger.databaseClassification='FICTIONAL_ONLY';
  ledger.manilaPayPeriod='2026-10-01/2026-10-15';
  ledger.deviceModel='Fictional physical Android device claim';
  ledger.browserVersion='Fictional mobile Chrome version claim';
  ledger.flags={livePayouts:false,governmentSubmission:false,realEmployeeData:false};
  ledger.runtimeVerification={
    verifiedAtUtc:ago(5),verifierRef:'qa-safety-independent',
    payoutAndFilingConfigRef:'vault://fictional-853/runtime-flags',
    deployedBuildRef:'vault://fictional-853/deployed-build',
    databaseIsolationRef:'vault://fictional-853/isolated-db',
    fixtureVersionRef:'vault://fictional-853/fixture-version',
  };
  ledger.identities={
    ownerBothId:'ownerAB',payrollOfficerAId:'payrollA',payrollOfficerBId:'payrollB',
    checkerBothId:'checkerAB',employeeAId:'empA',employeeBId:'empB',
  };
  const personaByCase={
    A_CLOCK_IN:'employeeAId',B_CLOCK_IN:'employeeBId',
    A_RUN_PAYROLL:'payrollOfficerAId',B_RUN_PAYROLL:'payrollOfficerBId',
    A_REVIEW:'checkerBothId',B_REVIEW:'checkerBothId',
    A_RELEASE_RECORDS:'ownerBothId',B_RELEASE_RECORDS:'ownerBothId',
    A_FILING_EVIDENCE:'payrollOfficerAId',B_FILING_EVIDENCE:'payrollOfficerBId',
    SWITCH_375:'ownerBothId',SWITCH_390:'ownerBothId',
    PAYROLL_A_DENIED_B:'payrollOfficerAId',EMPLOYEE_A_DENIED_B:'employeeAId',
  };
  for (const row of ledger.tests) {
    row.observedStatus='PASS';
    row.observedAtUtc=ago(4);
    row.observedBy=ledger.identities[personaByCase[row.id]]||'test-operator';
    row.evidenceRef='vault://fictional-853/'+row.id;
    row.independentReviewer='independent-checker';
  }
  ledger.signoff={
    independentReviewerId:'independent-checker',
    signedAtUtc:ago(3),
    privateEvidenceRef:'vault://fictional-853/signoff',
  };
  return ledger;
}

test('blank v2 initializes 18 staged and 9 cross-tenant NOT_RUN checks without claiming safety',()=>{
  const l=makeBlankLedger();
  assert.equal(l.schema,'payrollph-issue853-human-acceptance-v2');
  assert.equal(l.databaseClassification,null);
  assert.equal(l.manilaPayPeriod,'');
  assert.equal(STAGES.length,9);
  assert.equal(CROSS_TENANT.length,9);
  assert.equal(l.tests.length,27);
  assert.equal(new Set(l.tests.map(s=>s.id)).size,27);
  assert.deepEqual(l.tests.filter(s=>s.tenant==='A').map(s=>s.id),STAGES.map(s=>'A_'+s[0]));
  assert.deepEqual(l.tests.filter(s=>s.tenant==='B').map(s=>s.id),STAGES.map(s=>'B_'+s[0]));
  assert.deepEqual(l.flags,{livePayouts:null,governmentSubmission:null,realEmployeeData:null});
  assert.deepEqual(l.runtimeVerification,{
    verifiedAtUtc:'',verifierRef:'',payoutAndFilingConfigRef:'',
    deployedBuildRef:'',databaseIsolationRef:'',fixtureVersionRef:'',
  });
  assert.ok(l.tests.every(s=>s.observedStatus==='NOT_RUN' && s.blockerCode===''));
  const report=evaluate(l);
  assert.equal(report.verdict,'NOT_READY');
  assert.deepEqual([report.passed,report.needsFix,report.blocked,report.notRun],[0,0,0,27]);
  assert.ok(report.problems.some(p=>p.includes('runtime verification')));
});

test('runtime verification, observations and signoff cannot predate the ledger session',()=>{
  const l=claimedCompletion();
  assert.equal(evaluate(l).verdict,'SELF_REPORTED_COMPLETE_REQUIRES_EXTERNAL_VERIFICATION');
  l.createdUtc=ago(4.5);
  assert.ok(evaluate(l).problems.some(p=>p.includes('Runtime safety verification predates ledger session creation')));
  l.createdUtc=ago(3.8);
  assert.ok(evaluate(l).problems.some(p=>p.includes('Observed row predates ledger session creation')));
  l.createdUtc=ago(2);
  assert.ok(evaluate(l).problems.some(p=>p.includes('Human signoff predates ledger session creation')));
  l.createdUtc=ago(6);
  assert.equal(evaluate(l).verdict,'SELF_REPORTED_COMPLETE_REQUIRES_EXTERNAL_VERIFICATION');
});

test('old v1 packet is refused, not silently migrated to v2',()=>{
  const l=makeBlankLedger();
  l.schema='payrollph-issue853-human-acceptance-v1';
  assert.equal(evaluate(l).verdict,'NOT_READY');
  assert.ok(evaluate(l).problems.some(s=>s.includes('archive v1')));
});

test('complete fictional operator claims can only be externally verified, never certified by script',()=>{
  const l=claimedCompletion(), result=evaluate(l);
  assert.equal(result.verdict,'SELF_REPORTED_COMPLETE_REQUIRES_EXTERNAL_VERIFICATION');
  assert.equal(result.total,27);
  assert.deepEqual([result.passed,result.needsFix,result.blocked,result.notRun],[27,0,0,0]);
  assert.deepEqual(result.problems,[]);
  assert.match(result.note,/cannot witness, authenticate or certify/);
});

test('Gregorian pay periods and source-persona alignment fail closed',()=>{
  const l=claimedCompletion();
  l.manilaPayPeriod='2026-02-30/2026-03-01';
  assert.ok(evaluate(l).problems.some(s=>s.includes('Invalid Gregorian Manila pay period')));
  l.manilaPayPeriod='2026-10-15/2026-10-01';
  assert.equal(evaluate(l).verdict,'NOT_READY');
  l.manilaPayPeriod='2026-10-01/2026-10-15';
  l.tests.find(s=>s.id==='A_CLOCK_IN').observedBy=l.identities.employeeBId;
  assert.ok(evaluate(l).problems.some(s=>s.includes('Wrong recorded persona for observed control: A_CLOCK_IN')));
  l.tests.find(s=>s.id==='A_CLOCK_IN').observedBy=l.identities.employeeAId;
  l.tests.find(s=>s.id==='PAYROLL_A_DENIED_B').observedBy=l.identities.payrollOfficerBId;
  assert.ok(evaluate(l).problems.some(s=>s.includes('Wrong recorded persona for observed control: PAYROLL_A_DENIED_B')));
});

test('distinct proof references are mandatory for app build, isolated database and fixture version',()=>{
  const l=claimedCompletion();
  l.runtimeVerification.deployedBuildRef='';
  assert.ok(evaluate(l).problems.some(s=>s.includes('separate private evidence')));
  l.runtimeVerification.deployedBuildRef='vault://fictional-853/deployed-build';
  l.runtimeVerification.fixtureVersionRef=l.runtimeVerification.databaseIsolationRef;
  assert.ok(evaluate(l).problems.some(s=>s.includes('Duplicate private evidence reference')));
  l.runtimeVerification.fixtureVersionRef='vault://fictional-853/fixture-version';
  assert.equal(evaluate(l).verdict,'SELF_REPORTED_COMPLETE_REQUIRES_EXTERNAL_VERIFICATION');
});

test('source, deployment, runtime flags and independently recorded safety are mandatory',()=>{
  const l=claimedCompletion();
  l.deployedSha='b'.repeat(40);
  assert.equal(evaluate(l).verdict,'NOT_READY');
  l.deployedSha=l.sourceSha;
  l.flags.livePayouts=null;
  assert.ok(evaluate(l).problems.some(s=>s.includes('livePayouts')));
  l.flags.livePayouts=false;
  l.flags.extra=false;
  assert.ok(evaluate(l).problems.some(s=>s.includes('Unexpected or missing runtime safety flags')));
  delete l.flags.extra;
  l.runtimeVerification.payoutAndFilingConfigRef='';
  assert.ok(evaluate(l).problems.some(s=>s.includes('dated human check')));
  l.runtimeVerification.payoutAndFilingConfigRef='vault://fictional-853/runtime-flags';
  l.runtimeVerification.verifierRef=l.tests[0].observedBy;
  assert.ok(evaluate(l).problems.some(s=>s.includes('safety verifier must be independent')));
  l.runtimeVerification.verifierRef='qa-safety-independent';
  l.runtimeVerification.verifiedAtUtc=ago(3.5);
  assert.ok(evaluate(l).problems.some(s=>s.includes('predates running-app safety verification')));
});

test('impossible or future UTC timestamps cannot support PASS, signoff, or runtime safety',()=>{
  const l=claimedCompletion();
  l.tests[0].observedAtUtc='2026-02-30T10:00:00Z';
  assert.equal(evaluate(l).verdict,'NOT_READY');
  l.tests[0].observedAtUtc=ago(-1);
  assert.equal(evaluate(l).verdict,'NOT_READY');
  l.tests[0].observedAtUtc=ago(4);
  l.runtimeVerification.verifiedAtUtc='2026-02-30T10:00:00Z';
  assert.equal(evaluate(l).verdict,'NOT_READY');
  l.runtimeVerification.verifiedAtUtc=ago(5);
  l.signoff.signedAtUtc=ago(4.5);
  assert.ok(evaluate(l).problems.some(s=>s.includes('signoff predates an observation')));
  l.signoff.signedAtUtc=ago(3);
  l.createdUtc='2026-02-30T10:00:00Z';
  assert.ok(evaluate(l).problems.some(s=>s.includes('session identity')));
});

test('modified controls, missing cases, duplicate IDs and non-HTTPS URL cannot become PASS',()=>{
  const l=claimedCompletion();
  l.tests[0].expected='Any employee is allowed';
  assert.equal(evaluate(l).verdict,'NOT_READY');
  l.tests[0].expected=STAGES[0][2];
  l.tests[1].id=l.tests[0].id;
  assert.ok(evaluate(l).problems.some(s=>s.includes('missing or duplicated')));
  l.tests[1].id='A_ONBOARD';
  l.developmentUrl='https://user:secret@example.invalid';
  assert.ok(evaluate(l).problems.some(s=>s.includes('credential-free')));
  l.developmentUrl='https://fictional-qa.example.invalid';
  l.identities.employeeAId=l.identities.employeeBId;
  assert.ok(evaluate(l).problems.some(s=>s.includes('All 6 test actor identities must be distinct')));
});

test('PASS cannot carry stale defects and independent evidence must be distinct across checks',()=>{
  const l=claimedCompletion();
  l.tests[0].defectRef='BUG-853-OPEN';
  assert.ok(evaluate(l).problems.some(s=>s.includes('PASS has unresolved defect')));
  l.tests[0].defectRef='';
  l.tests[1].evidenceRef=l.tests[0].evidenceRef;
  assert.ok(evaluate(l).problems.some(s=>s.includes('Duplicate private evidence reference')));
  l.tests[1].evidenceRef='vault://fictional-853/A_ONBOARD';
  l.tests[1].independentReviewer=l.tests[1].observedBy;
  assert.ok(evaluate(l).problems.some(s=>s.includes('distinct reviewer')));
  l.tests[1].independentReviewer='independent-checker';
  l.tests[0].observedBy='independent-checker';
  assert.ok(evaluate(l).problems.some(s=>s.includes('Final independent reviewer cannot sign off')));
});

test('NEEDS_FIX requires witnessed observation and opaque BUG ID; BLOCKED and NOT_RUN carry no observations',()=>{
  const l=claimedCompletion();
  l.tests[0].observedStatus='NEEDS_FIX';
  l.tests[0].defectRef='BUG-853-HIRE';
  let result=evaluate(l);
  assert.equal(result.needsFix,1);
  assert.equal(result.passed,26);
  assert.equal(result.verdict,'NOT_READY');
  l.tests[0].defectRef='';
  assert.ok(evaluate(l).problems.some(s=>s.includes('NEEDS_FIX requires opaque BUG-')));
  l.tests[0].defectRef='BUG-853-HIRE';
  l.tests[0].observedAtUtc='';
  assert.ok(evaluate(l).problems.some(s=>s.includes('Observed row missing dated observation')));
  l.tests[0].observedStatus='BLOCKED';
  l.tests[0].blockerCode='DEVICE';
  assert.ok(evaluate(l).problems.some(s=>s.includes('BLOCKED cannot contain claimed observation')));
  Object.assign(l.tests[0],{
    observedAtUtc:'',observedBy:'',evidenceRef:'',independentReviewer:'',defectRef:'',
  });
  result=evaluate(l);
  assert.equal(result.blocked,1);
  assert.equal(result.passed,26);
  l.tests[0].blockerCode='';
  assert.ok(evaluate(l).problems.some(s=>s.includes('BLOCKED requires an approved blocker code')));
  l.tests[0].observedStatus='NOT_RUN';
  l.tests[0].blockerCode='';
  l.tests[0].observedAtUtc=ago(4);
  assert.ok(evaluate(l).problems.some(s=>s.includes('NOT_RUN cannot contain stale observation')));
  l.tests[0].observedStatus='FAIL';
  assert.ok(evaluate(l).problems.some(s=>s.includes('Invalid status')));
});

test('CLI init is non-overwriting, private-only; check exits 2 without fabricated evidence',async()=>{
  // Always runs, even on local Windows without symlink permissions.
  const home=await mkdtemp(join(tmpdir(),'issue853-v2-test-'));
  try {
    const pathname=join(home,'private-evidence','ledger.json');
    const run=(verb,file)=>spawnSync(process.execPath,[script,verb,file],{encoding:'utf8',cwd:repoRoot});
    const first=run('init',pathname);
    assert.equal(first.status,0,first.stderr);
    assert.match(first.stdout,/All statuses: NOT_RUN/);
    const saved=JSON.parse(await readFile(pathname,'utf8'));
    assert.equal(saved.tests.length,27);
    assert.equal(saved.flags.livePayouts,null);
    assert.equal(run('check',pathname).status,2);
    assert.equal(run('init',pathname).status,1,'must refuse overwriting an evidence ledger');
    assert.equal(run('init',join(repoRoot,'qa-artifacts','issue853-private-test.json')).status,1);
  } finally {
    await rm(home,{recursive:true,force:true});
  }
});

test('CLI refuses a directory symlink redirecting private evidence into checkout',
  { skip: symlinkSkip },async()=>{
  // symlinkSkip can skip a *local* machine lacking privileges, NEVER in CI.
  const home=await mkdtemp(join(tmpdir(),'issue853-v2-symlink-test-'));
  try {
    const alias=join(home,'symlink-to-repo');
    await symlink(repoRoot,alias,'dir');
    const result=spawnSync(process.execPath,[script,'init',join(alias,'should-not-exist.json')],{
      encoding:'utf8',cwd:repoRoot,
    });
    assert.equal(result.status,1,'symlink must not redirect private evidence into checkout');
  } finally {
    await rm(home,{recursive:true,force:true});
  }
});
