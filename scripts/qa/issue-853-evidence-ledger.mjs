#!/usr/bin/env node
/**
 * Payroll PH #853 manual employer-journey evidence ledger.
 * Records operator claims but NEVER certifies independent human observation.
 * No app credentials, real employee records, data migrations, or HTTP actions.
 * Node 22+, no third-party dependencies.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STAGES = Object.freeze([
  ['HIRE', 'Owner / HR', 'Create a fictional candidate, approve hire, confirm exactly one worker ID'],
  ['ONBOARD', 'Owner / HR / Employee', 'Complete fictional employee identity and payroll setup; confirm employee-side view'],
  ['SCHEDULE', 'Manager', 'Assign a dated shift in the Manila timezone; confirm role/tenant ownership'],
  ['CLOCK_IN', 'Employee', 'Record a punch on the assigned shift; ensure no duplicate punches'],
  ['APPROVE_TIME', 'Manager', 'Review exceptions and approve timesheet; retain approver audit trace'],
  ['RUN_PAYROLL', 'Payroll Officer', 'Calculate a fictional period; show itemized gross-to-net; do not disburse'],
  ['REVIEW', 'Independent Checker', 'Compare independently computed amounts; preserve separation of duties'],
  ['RELEASE_RECORDS', 'Owner', 'Release payroll RECORDS only; prove payouts and live transfers remain off'],
  ['FILING_EVIDENCE', 'Payroll Officer', 'Produce draft filing worksheet/evidence without external agency submission'],
]);
export const CROSS_TENANT = Object.freeze([
  ['SWITCH_375', 'Owner', 'Switch A to B and back at 375px without stale tenant data'],
  ['SWITCH_390', 'Owner', 'Switch A to B and back at 390px without stale tenant data'],
  ['PAYROLL_A_DENIED_B', 'Payroll Officer A-only', 'Direct request for B payroll returns 403/404 and no B data'],
  ['EMPLOYEE_A_DENIED_B', 'Employee A-only', 'Direct request for B worker returns 403/404 and no B data'],
  ['OWNER_AND_PAYROLL_SEPARATE', 'Owner and Payroll Officer', 'Different identities and responsibilities; no self-approval bypass'],
  ['PAYOUTS_AND_FILING_OFF', 'Owner / Payroll Officer', 'No live banking/payout request or government submission'],
  ['RECOVER_INTERRUPTION', 'Owner / Payroll Officer', 'Interrupt network or session mid-work and recover without duplicate submission'],
  ['RESUME_AFTER_LOGIN', 'Owner / Payroll Officer', 'Log out and resume the correct employer/stage from saved state'],
  ['INDEPENDENT_HUMAN_NAVIGATION', 'Independent Human Reviewer', 'Finish full journey without a developer guiding the screen'],
]);
const ALLOWED_STATUS = new Set(['NOT_RUN', 'PASS', 'FAIL', 'BLOCKED']);
const SOURCE_SHA = /^[a-f\d]{40}$/;
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/;
const EVIDENCE_REF = /^(?:private|vault|local):\/\/[A-Za-z0-9/_:.#-]{4,240}$/;

function checks() {
  const suite=[];
  for (const tenant of ['A', 'B']) {
    for (const [stage, performerRole, expected] of STAGES) {
      suite.push({id: `${tenant}_${stage}`, tenant, performerRole, expected,
        observedStatus: 'NOT_RUN', observedAtUtc: '', observedBy: '', evidenceRef: '',
        independentReviewer: '', notes: '', defectRef: ''});
    }
  }
  for (const [id, performerRole, expected] of CROSS_TENANT) {
    suite.push({id, tenant: 'A+B', performerRole, expected,
      observedStatus: 'NOT_RUN', observedAtUtc: '', observedBy: '', evidenceRef: '',
      independentReviewer: '', notes: '', defectRef: ''});
  }
  return suite;
}

export function makeBlankLedger() {
  return {
    schema: 'payrollph-issue853-human-acceptance-v2',
    recordId: randomUUID(),
    createdUtc: new Date().toISOString(),
    scope: 'FICTIONAL_DEVELOPMENT_NO_MONEY',
    sourceSha: '',
    deployedSha: '',
    developmentUrl: '',
    databaseClassification: 'FICTIONAL_ONLY',
    deviceModel: '',
    browserVersion: '',
    manilaPayPeriod: '2026-10-01/2026-10-15',
    tenantA: 'Fictional Harbor A Services',
    tenantB: 'Fictional Riverside B Trading',
    identities: { ownerBothId: '', payrollOfficerAId: '', payrollOfficerBId: '', checkerBothId: '', employeeAId: '', employeeBId: '' },
    flags: { livePayouts: null, governmentSubmission: null, realEmployeeData: null },
    safetyVerification: { verifiedAtUtc: '', verifierRef: '', evidenceRef: '' },
    tests: checks(),
    signoff: { independentReviewerId: '', signedAtUtc: '', privateEvidenceRef: '' },
    IMPORTANT: 'Version 2: all runtime safety flags start UNVERIFIED (null). Only a human who checked the running app may set false and supply safetyVerification. No independent observation is authenticated by this script.',
  };
}

function validDate(s) {
  if (typeof s !== 'string' || !UTC.test(s)) return false;
  const timestamp = Date.parse(s);
  if (!Number.isFinite(timestamp) || timestamp > Date.now()) return false;
  // Date.parse silently normalizes impossible dates (for example February 30).
  const canonical = s.includes('.')
    ? s.replace(/\.(\d{1,3})Z$/, (_match, ms) => '.' + ms.padEnd(3, '0') + 'Z')
    : s.slice(0, -1) + '.000Z';
  return new Date(timestamp).toISOString() === canonical;
}
function meaningful(s) { return typeof s === 'string' && s.trim().length > 0; }

/**
 * Pure validation; never writes to DB or touches app. Observed statuses are
 * operator inputs. A passing candidate is NOT independent certification.
 */
export function evaluate(ledger) {
  const blockers=[];
  if (!ledger || ledger.schema!=='payrollph-issue853-human-acceptance-v2') {
    return {verdict: 'NOT_READY', total:27, passed:0, failed:0, blocked:27,
      problems: ['Invalid evidence schema; refuse to infer a successful acceptance']};
  }
  if (ledger.scope!=='FICTIONAL_DEVELOPMENT_NO_MONEY') blockers.push('Wrong scope');
  if (ledger.databaseClassification!=='FICTIONAL_ONLY') blockers.push('Database must be classified as fictional');
  if (!SOURCE_SHA.test(ledger.sourceSha||'')) blockers.push('Source SHA must be an exact 40-character Git commit');
  if (!SOURCE_SHA.test(ledger.deployedSha||'')) blockers.push('Deployment SHA must be an exact 40-character Git commit');
  if (ledger.sourceSha!==ledger.deployedSha) blockers.push('Deployed SHA does not equal reviewed source SHA');
  if (!/^https:\/\//.test(ledger.developmentUrl||'')) blockers.push('A real development HTTPS URL has not been recorded');
  for (const [flag, value] of Object.entries(ledger.flags||{})) {
    if (value!==false) blockers.push(`${flag} must remain false`);
  }
  for (const required of ['livePayouts','governmentSubmission','realEmployeeData']) {
    if (ledger.flags?.[required]!==false) blockers.push(`${required} must explicitly be false`);
  }
  // A template cannot assert that payments/filing are OFF before anyone has
  // checked the actual running application. Keep historical v1 ledgers archived;
  // never silently promote their prefilled false flags to witnessed evidence.
  const safety = ledger.safetyVerification;
  if (!safety || !validDate(safety.verifiedAtUtc) ||
      !meaningful(safety.verifierRef) || !EVIDENCE_REF.test(safety.evidenceRef||'')) {
    blockers.push('Runtime safety flags require a dated human check and private evidence');
  }
  if (!meaningful(ledger.deviceModel) || !meaningful(ledger.browserVersion)) blockers.push('Record actual tested device/browser');
  if (!ledger.identities || Object.values(ledger.identities).some(x=>!meaningful(x))) {
    blockers.push('Record pseudonymous IDs for owner, payroll A, payroll B, checker and both employees');
  } else if (new Set(Object.values(ledger.identities)).size !== 6) {
    blockers.push('All 6 test actor identities must be distinct');
  }
  const expected=checks();
  const expectedIds=expected.map(x=>x.id);
  const incoming=Array.isArray(ledger.tests)?ledger.tests:[];
  if (incoming.length!==expected.length || new Set(incoming.map(x=>x.id)).size!==expected.length ||
      !expectedIds.every(id=>incoming.some(x=>x.id===id))) blockers.push('Mandatory journey/tenant checks missing or duplicated');
  let passed=0,failed=0,blocked=0;
  for (const scenario of incoming) {
    if (!expectedIds.includes(scenario.id)) {blockers.push('Unrecognized test ID');continue;}
    const canon=expected.find(x=>x.id===scenario.id);
    if (scenario.tenant!==canon.tenant || scenario.performerRole!==canon.performerRole || scenario.expected!==canon.expected) {
      blockers.push(`Modified expected control: ${scenario.id}`);
    }
    if (!ALLOWED_STATUS.has(scenario.observedStatus)) {
      blockers.push(`Invalid status: ${scenario.id}`);continue;
    }
    if (scenario.observedStatus==='PASS') {
      passed++;
      if (!validDate(scenario.observedAtUtc) || !meaningful(scenario.observedBy) ||
          !EVIDENCE_REF.test(scenario.evidenceRef||'') ||
          !meaningful(scenario.independentReviewer) ||
          scenario.independentReviewer===scenario.observedBy) {
        blockers.push(`PASS missing dated observation, private evidence and distinct reviewer: ${scenario.id}`);
      }
      if (validDate(scenario.observedAtUtc) && validDate(safety?.verifiedAtUtc) &&
          Date.parse(scenario.observedAtUtc)<Date.parse(safety.verifiedAtUtc)) {
        blockers.push(`PASS predates running-app safety verification: ${scenario.id}`);
      }
    } else if(scenario.observedStatus==='FAIL') {
      failed++;
      if (!meaningful(scenario.defectRef)) blockers.push(`FAIL missing defect reference: ${scenario.id}`);
    } else {
      blocked++;
    }
  }
  if (!ledger.signoff || !meaningful(ledger.signoff.independentReviewerId) ||
      !validDate(ledger.signoff.signedAtUtc) ||
      !EVIDENCE_REF.test(ledger.signoff.privateEvidenceRef||'')) {
    blockers.push('Independent reviewer human signoff evidence not supplied');
  }
  if (validDate(ledger.signoff?.signedAtUtc)) {
    const signedAt = Date.parse(ledger.signoff.signedAtUtc);
    if (validDate(safety?.verifiedAtUtc) && signedAt < Date.parse(safety.verifiedAtUtc)) {
      blockers.push('Human signoff predates verified runtime safety');
    }
    if (incoming.some(s => s.observedStatus==='PASS' && validDate(s.observedAtUtc) &&
        Date.parse(s.observedAtUtc)>signedAt)) {
      blockers.push('Human signoff predates an observed PASS');
    }
    if (incoming.some(s => s.observedStatus==='PASS' && s.observedBy===ledger.signoff.independentReviewerId)) {
      blockers.push('Final independent reviewer cannot sign off their own operator observations');
    }
  }
  const all=expected.length;
  const ready=passed===all && failed===0 && blocked===0 && blockers.length===0;
  return {
    verdict: ready ? 'SELF_REPORTED_COMPLETE_REQUIRES_EXTERNAL_VERIFICATION' : 'NOT_READY',
    total:all,passed,failed,blocked,
    problems:[...new Set(blockers)],
    note:'This tool cannot witness, authenticate or certify real human activity. A reviewer must validate primary evidence separately.',
  };
}

function outsideWorkingDir(path) {
  // Anchor to the actual checkout, not the caller's arbitrary subdirectory.
  const absolute=resolve(path),root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
  const rel=relative(root,absolute);
  if (!isAbsolute(path) || rel==='' || (!rel.startsWith('..'+sep) && rel!=='..' && !isAbsolute(rel))) {
    throw new Error('PRIVATE_EVIDENCE_FILE_MUST_BE_ABSOLUTE_AND_OUTSIDE_REPOSITORY');
  }
  return absolute;
}

async function main() {
  const [verb, filepath]=process.argv.slice(2);
  if (!['init','check'].includes(verb) || !filepath) throw new Error('USAGE: node issue-853-evidence-ledger.mjs init|check ABSOLUTE_PRIVATE_PATH.json');
  const path=outsideWorkingDir(filepath);
  if (verb==='init') {
    const ledger=makeBlankLedger();
    await mkdir(dirname(path),{recursive:true,mode:0o700});
    await writeFile(path,JSON.stringify(ledger,null,2)+'\n',{flag:'wx',mode:0o600});
    process.stdout.write(`CREATED_PRIVATE_LEDGER\nScenarios: ${ledger.tests.length}\nAll statuses: NOT_RUN\n`);
  } else {
    const content=JSON.parse(await readFile(path,'utf8'));
    const result=evaluate(content);
    // Print only aggregate counts and validator problem codes; not private evidence or names.
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    if (result.verdict==='NOT_READY') process.exitCode=2;
  }
}

if (process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(()=>{process.stderr.write('ISSUE_853_LEDGER_COMMAND_FAILED\n');process.exitCode=1;});
}
