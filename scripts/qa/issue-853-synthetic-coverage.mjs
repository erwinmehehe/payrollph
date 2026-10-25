#!/usr/bin/env node
/**
 * Scope-bound automated receipt for #853. The existing connected CI proves
 * two complete fictional employer payroll journeys against one disposable
 * database, plus isolated tenant/mobile denials. It does NOT establish any
 * independently witnessed human observation. Never promote these to UAT PASS.
 *
 * No application reads, no credentials, no historical DB migration.
 */
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGES, CROSS_TENANT } from './issue-853-evidence-ledger.mjs';

const NAMES = ['Hire','Onboard','Schedule','Clock In','Approve Time','Run Payroll',
  'Review','Release Payroll Records','Prepare Filing Evidence'];
const HEX = /^[0-9a-f]{64}$/;
const FULL_SHA = /^[0-9a-f]{40}$/;
// Controls are written by the verified HTTP harness as exact labels.
// A partial match could accept "NOT VERIFIED: <expected denial>" as PASS.
const hasExactLabel = (items, label) => Array.isArray(items) && items.includes(label);
const positiveId = value => Number.isSafeInteger(value) && value > 0;
function validDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
}
function verifyStages(rows, employer) {
  assert.ok(Array.isArray(rows), employer + ' stages missing');
  assert.deepEqual(rows.map(s => s.name), NAMES, employer + ' stage order changed');
  for (const entry of rows) {
    assert.equal(entry.status, 'PASS', employer + ' ' + entry.name + ' did not pass');
    assert.ok(Array.isArray(entry.evidence) && entry.evidence.some(s =>
      typeof s === 'string' && s.trim().length > 0),
      employer + ' ' + entry.name + ' has no recorded synthetic step evidence');
  }
}
function verifyDraftHashes(hashes, employer) {
  assert.deepEqual(Object.keys(hashes || {}).sort(), ['BIR','Pag-IBIG','PhilHealth','SSS'].sort(),
    employer + ' must generate each of the four draft filing artifacts');
  const values = Object.values(hashes);
  assert.ok(values.every(value => typeof value === 'string' && HEX.test(value)),
    employer + ' draft bytes must have full SHA-256 digests');
  assert.equal(new Set(values).size, 4,
    employer + ' four agency files must have distinct byte hashes');
}

export function buildIssue853SyntheticScope(connected,mobile,sha) {
  assert.match(sha, FULL_SHA);
  assert.equal(connected?.sourceSha,sha,'Connected report must belong to exact checked-out commit');
  assert.equal(mobile?.sourceSha,sha,'Browser report must belong to same exact commit');
  assert.equal(connected?.result,'PASS');
  assert.equal(mobile?.result,'PASS');
  assert.match(connected?.scope||'', /^synthetic-local-postgres(?:16|18)-only$/);
  assert.equal(connected?.schemaVersion, 1);
  assert.equal(connected?.postgresMajor,
    Number(connected.scope.match(/postgres(16|18)-only$/)[1]),
    'PostgreSQL major must match the connected test environment');
  assert.equal(connected?.clock?.mode, 'CI_GUARDED_VIRTUAL_MANILA_MONTH_END');
  assert.equal(connected?.clock?.actualApiCapture, true);
  assert.equal(connected?.clock?.realWallClockAttendance, false);
  assert.equal(connected?.physicalDeviceUat, 'NOT_RUN');
  assert.equal(mobile?.mode, 'synthetic Chromium, no physical device');
  assert.equal(connected?.independentHumanUat,'NOT_RUN');
  assert.equal(connected?.realEmployerReconciliation,'NOT_RUN');
  assert.equal(connected?.bankOrPaymentSubmission,'PROHIBITED');
  assert.equal(connected?.officialAgencySubmission,'NOT_RUN');
  assert.equal(mobile?.independentHumanUat,false);
  verifyStages(connected?.stages, 'Employer A');
  verifyStages(connected?.employerBStages, 'Employer B');
  const lineage = connected?.lineage;
  for (const name of ['organizationId','shadowOrganizationId','employeeId',
    'employerBWorkerId','sourcePunchId','payrollRunId']) {
    assert.ok(positiveId(lineage?.[name]), 'Missing real fictional A/B lineage ID: ' + name);
  }
  assert.notEqual(lineage.organizationId, lineage.shadowOrganizationId);
  assert.notEqual(lineage.employeeId, lineage.employerBWorkerId);
  assert.equal(lineage.separateEmployerSameLocalEmployeeNo, true);
  assert.ok(['periodStart','periodEnd','payDate','employeeHireDate']
    .every(name => validDay(lineage[name])), 'Connected payroll dates must be real Manila calendar dates');
  assert.ok(lineage.periodStart <= lineage.periodEnd &&
    lineage.payDate >= lineage.periodEnd, 'Invalid pay-period or date ordering');
  assert.equal(lineage.employeeHireDate, lineage.periodStart,
    'The hired worker must belong to the tested attendance/payroll cutoff');
  const employerB=lineage.employerB;
  assert.equal(employerB?.organizationId,connected.lineage.shadowOrganizationId);
  assert.equal(employerB?.employeeId,connected.lineage.employerBWorkerId);
  assert.ok(positiveId(employerB?.employeeId));
  assert.notEqual(employerB.employeeId,connected.lineage.employeeId);
  assert.equal(employerB.periodStart,connected.lineage.periodStart);
  assert.equal(employerB.periodEnd,connected.lineage.periodEnd);
  assert.equal(employerB.payDate,connected.lineage.payDate);
  assert.ok(positiveId(employerB.sourcePunchId));
  assert.ok(positiveId(employerB.payrollRunId));
  assert.notEqual(employerB.sourcePunchId,connected.lineage.sourcePunchId);
  assert.notEqual(employerB.payrollRunId,connected.lineage.payrollRunId);
  verifyDraftHashes(lineage.draftHashes, 'Employer A');
  verifyDraftHashes(employerB.draftHashes, 'Employer B');
  const negatives=connected.negativeControls;
  assert.ok(Array.isArray(negatives) && new Set(negatives).size === negatives.length,
    'Source HTTP denial labels must not be missing or repeated');
  for(const control of [
    'tenant B-only owner denied A employees',
    'tenant A payroll officer denied B payroll',
    'tenant B cannot inspect the released tenant A payroll',
    'payroll maker cannot approve checker task',
    'duplicate record release rejected',
    'tenant B-only payroll officer denied A payroll',
    'tenant A HR cannot read B onboarding',
    'tenant A HR denied B roster',
    'B employee cannot approve own attendance',
    'A-only payroll cannot read B calculated register',
    'B payroll maker cannot self-approve',
    'B checker cannot release payroll records',
    'duplicate B record release denied',
    'B-only owner cannot read A released payroll',
    'BIR A payroll denied B draft',
  ])assert.ok(hasExactLabel(negatives,control),
    'Missing exact verified cross-tenant denial: '+control);
  for(const width of [375,390]) {
    assert.ok(mobile?.widths?.includes(width),'Missing required viewport');
    assert.ok(hasExactLabel(mobile.checks,
      width+'px failure/retry and owner switch A -> B -> A; disjoint tenant employee records'),
      'Missing exact verified tenant-switch/retry at '+width+'px');
    assert.ok(hasExactLabel(mobile.checks,
      width+'px verified employee session and cross-tenant 403'),
      'Missing exact authenticated employee denial at '+width+'px');
  }
  assert.equal(STAGES.length,9);
  assert.equal(CROSS_TENANT.length,9);
  return {
    schema:'payrollph-issue853-synthetic-two-tenant-scope-v2',
    sourceSha:sha,
    result:'SYNTHETIC_SCOPE_PASS_NOT_INDEPENDENT_UAT',
    environment:connected.scope,
    employerCount:2,
    fullyAutomatedEmployerJourneys:2,
    employerA:{automatedStagesPassed:NAMES.length,automatedStagesTotal:NAMES.length},
    employerB:{automatedStagesPassed:NAMES.length,automatedStagesTotal:NAMES.length,
      status:'FULL_SOURCE_CONNECTED_SYNTHETIC_NO_MONEY'},
    automatedControls:{
      aPayrollDeniedB:true,bOwnerDeniedA:true,bPayrollDeniedA:true,
      protectedMakerChecker:true,authenticatedBDirectoryDeniedByEmployeeA:true,
      aToBToAAt375:true,aToBToAAt390:true,retryWithoutStaleTenant:true,
      livePayouts:false,officialSubmissions:false,
    },
    humanObservation:{total:STAGES.length*2+CROSS_TENANT.length,passed:0,
      status:'ALL_NOT_RUN',independentlyWitnessed:false},
    releaseAuthorization:'NO_GO',
    evidenceClassification:'SANITIZED_MACHINE_METADATA_NO_CREDENTIALS_OR_EMPLOYEE_ROWS',
    note:'Both fictional employers completed nine isolated-source HTTP stages in disposable PostgreSQL. Independent 27-case human UAT, physical devices and real employer parallel payroll remain NOT_RUN.',
  };
}

function main() {
  assert.equal(process.env.CI,'true');
  assert.equal(process.env.GITHUB_ACTIONS,'true');
  assert.equal(process.env.QA_URL,'http://127.0.0.1:3000');
  assert.equal(process.env.DEMO_MODE,'false');
  assert.equal(process.env.PAYMONGO_DISBURSEMENTS_ENABLED,'false');
  assert.equal(process.env.XENDIT_PAYOUTS_ENABLED,'false');
  const dbUrl=new URL(process.env.DATABASE_URL||'');
  assert.equal(dbUrl.hostname,'127.0.0.1');
  assert.equal(dbUrl.pathname,'/app_db');
  const sha=process.env.PR_HEAD_SHA;
  const connected=JSON.parse(readFileSync('qa-artifacts/nine-stage-connected-report.json','utf8'));
  const browser=JSON.parse(readFileSync('qa-artifacts/nine-stage-mobile-report.json','utf8'));
  const receipt=buildIssue853SyntheticScope(connected,browser,sha);
  mkdirSync('qa-artifacts',{recursive:true});
  writeFileSync('qa-artifacts/issue-853-synthetic-two-tenant-scope.json',
    JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
  process.stdout.write('ISSUE_853_SYNTHETIC_A_AND_B_9_OF_9; HUMAN_0_OF_27\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { main(); } catch { process.stderr.write('ISSUE_853_SYNTHETIC_SCOPE_BLOCKED\n');process.exitCode=1; }
}
