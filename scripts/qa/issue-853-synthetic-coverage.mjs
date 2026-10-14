#!/usr/bin/env node
/**
 * Scope-bound automated receipt for #853. The existing connected CI proves
 * a full fictional Employer A journey, a separate B shadow tenant, and
 * negative tenant / mobile checks. It does NOT prove B's nine-stage payroll
 * or a single actual human observation. Never promote these to UAT PASS.
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
const match = (lines, needle) => Array.isArray(lines) && lines.some(x =>
  typeof x === 'string' && x.includes(needle));

export function buildIssue853SyntheticScope(connected,mobile,sha) {
  assert.match(sha, FULL_SHA);
  assert.equal(connected?.sourceSha,sha,'Connected report must belong to exact checked-out commit');
  assert.equal(mobile?.sourceSha,sha,'Browser report must belong to same exact commit');
  assert.equal(connected?.result,'PASS');
  assert.equal(mobile?.result,'PASS');
  assert.match(connected?.scope||'', /^synthetic-local-postgres(?:16|18)-only$/);
  assert.equal(connected?.independentHumanUat,'NOT_RUN');
  assert.equal(connected?.realEmployerReconciliation,'NOT_RUN');
  assert.equal(connected?.bankOrPaymentSubmission,'PROHIBITED');
  assert.equal(connected?.officialAgencySubmission,'NOT_RUN');
  assert.equal(mobile?.independentHumanUat,false);
  assert.deepEqual(connected?.stages?.map(s=>s.name),NAMES);
  assert.ok(connected.stages.every(s=>s.status==='PASS'));
  assert.ok(connected?.lineage?.organizationId>0);
  assert.ok(connected?.lineage?.shadowOrganizationId>0);
  assert.notEqual(connected.lineage.organizationId,connected.lineage.shadowOrganizationId);
  assert.equal(connected.lineage.separateEmployerSameLocalEmployeeNo,true);
  assert.ok(connected.lineage.sourcePunchId>0 && connected.lineage.payrollRunId>0);
  const hashes=connected?.lineage?.draftHashes;
  assert.deepEqual(Object.keys(hashes||{}).sort(),['BIR','Pag-IBIG','PhilHealth','SSS'].sort());
  assert.ok(Object.values(hashes).every(value=>typeof value==='string'&&HEX.test(value)));
  const negatives=connected.negativeControls;
  for(const control of [
    'tenant B-only owner denied A employees',
    'tenant A payroll officer denied B payroll',
    'tenant B cannot inspect the released tenant A payroll',
    'payroll maker cannot approve checker task',
    'duplicate record release rejected',
  ])assert.ok(match(negatives,control),'Missing cross-tenant or separation evidence: '+control);
  for(const width of [375,390]) {
    assert.ok(mobile?.widths?.includes(width),'Missing required viewport');
    assert.ok(match(mobile.checks,width+'px failure/retry and owner switch A -> B -> A'),
      'Missing tenant-switch/retry at '+width+'px');
    assert.ok(match(mobile.checks,width+'px verified employee session and cross-tenant 403'),
      'Missing authenticated employee denial at '+width+'px');
  }
  assert.equal(STAGES.length,9);
  assert.equal(CROSS_TENANT.length,9);
  return {
    schema:'payrollph-issue853-synthetic-two-tenant-scope-v1',
    sourceSha:sha,
    result:'SYNTHETIC_SCOPE_PASS_NOT_INDEPENDENT_UAT',
    environment:connected.scope,
    employerCount:2,
    fullyAutomatedEmployerJourneys:1,
    employerA:{automatedStagesPassed:NAMES.length,automatedStagesTotal:NAMES.length},
    employerB:{automatedStagesPassed:0,automatedStagesTotal:NAMES.length,
      status:'SHADOW_TENANT_ISOLATION_ONLY_FULL_PAYROLL_NOT_RUN'},
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
    note:'Only Employer A completed all nine stages. Employer B is an isolation shadow. Separate B full payroll and 27 human-observed checks remain NOT_RUN.',
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
  process.stdout.write('ISSUE_853_SYNTHETIC_A_AND_B_SHADOW_PASS; B_PAYROLL_NOT_RUN; HUMAN_0_OF_27\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { main(); } catch { process.stderr.write('ISSUE_853_SYNTHETIC_SCOPE_BLOCKED\n');process.exitCode=1; }
}
