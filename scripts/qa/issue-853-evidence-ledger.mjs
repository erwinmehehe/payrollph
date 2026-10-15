#!/usr/bin/env node
/**
 * Payroll PH #853 manual employer-journey evidence ledger.
 * Records operator claims but NEVER certifies independent human observation.
 * No app credentials, real employee records, data migrations, or HTTP actions.
 * Node 22+, no third-party dependencies.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
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
const ALLOWED_STATUS = new Set(['NOT_RUN', 'PASS', 'NEEDS_FIX', 'BLOCKED']);
const BLOCKER_CODES = new Set(['DEVICE', 'ENVIRONMENT', 'ROLE', 'DATA', 'REVIEWER', 'OTHER']);
const DEFECT_REF = /^BUG-[A-Z0-9][A-Z0-9-]{2,79}$/;
const SOURCE_SHA = /^[a-f\d]{40}$/;
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/;
const EVIDENCE_REF = /^(?:private|vault|local):\/\/[A-Za-z0-9/_:.#-]{4,240}$/;

function checks() {
  const suite=[];
  for (const tenant of ['A', 'B']) {
    for (const [stage, performerRole, expected] of STAGES) {
      suite.push({id: `${tenant}_${stage}`, tenant, performerRole, expected,
        observedStatus: 'NOT_RUN', observedAtUtc: '', observedBy: '', evidenceRef: '',
        independentReviewer: '', notes: '', defectRef: '', blockerCode: ''});
    }
  }
  for (const [id, performerRole, expected] of CROSS_TENANT) {
    suite.push({id, tenant: 'A+B', performerRole, expected,
      observedStatus: 'NOT_RUN', observedAtUtc: '', observedBy: '', evidenceRef: '',
      independentReviewer: '', notes: '', defectRef: '', blockerCode: ''});
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

function validDevelopmentUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('https://')) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) &&
      !url.username && !url.password && !url.hash;
  } catch { return false; }
}


/**
 * Pure validation; never writes to DB or touches app. Observed statuses are
 * operator inputs. A passing candidate is NOT independent certification.
 */
export function evaluate(ledger) {
  const blockers=[];
  const expected=checks();
  if (!ledger || ledger.schema!=='payrollph-issue853-human-acceptance-v2') {
    return {verdict:'NOT_READY', total:27, passed:0, needsFix:0, blocked:0, notRun:27,
      problems:['Invalid evidence schema; archive v1 privately and start a blank v2 session']};
  }
  if (ledger.scope!=='FICTIONAL_DEVELOPMENT_NO_MONEY') blockers.push('Wrong scope');
  if (ledger.databaseClassification!=='FICTIONAL_ONLY') blockers.push('Database must be classified as fictional');
  if (!validDate(ledger.createdUtc) || typeof ledger.recordId!=='string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ledger.recordId)) {
    blockers.push('Invalid private ledger session identity or created UTC time');
  }
  if (!SOURCE_SHA.test(ledger.sourceSha||'')) blockers.push('Source SHA must be an exact 40-character Git commit');
  if (!SOURCE_SHA.test(ledger.deployedSha||'')) blockers.push('Deployment SHA must be an exact 40-character Git commit');
  if (ledger.sourceSha!==ledger.deployedSha) blockers.push('Deployed SHA does not equal reviewed source SHA');
  if (!validDevelopmentUrl(ledger.developmentUrl)) blockers.push('A credential-free development HTTPS URL must be recorded');

  const requiredFlags=['livePayouts','governmentSubmission','realEmployeeData'];
  if (!ledger.flags || typeof ledger.flags!=='object' || Array.isArray(ledger.flags) ||
      Object.keys(ledger.flags).sort().join(',')!==[...requiredFlags].sort().join(',')) {
    blockers.push('Unexpected or missing runtime safety flags');
  }
  for (const key of requiredFlags) {
    if (ledger.flags?.[key]!==false) blockers.push(key+' must explicitly be false following runtime verification');
  }
  const safety=ledger.safetyVerification;
  if (!safety || !validDate(safety.verifiedAtUtc) ||
      !meaningful(safety.verifierRef) || !EVIDENCE_REF.test(safety.evidenceRef||'')) {
    blockers.push('Runtime safety flags require a dated human check and private evidence');
  }
  if (!meaningful(ledger.deviceModel) || !meaningful(ledger.browserVersion)) {
    blockers.push('Record actual tested device/browser');
  }
  const requiredActors=['ownerBothId','payrollOfficerAId','payrollOfficerBId','checkerBothId','employeeAId','employeeBId'];
  if (!ledger.identities || typeof ledger.identities!=='object' || Array.isArray(ledger.identities) ||
      Object.keys(ledger.identities).sort().join(',')!==[...requiredActors].sort().join(',') ||
      requiredActors.some(key=>!meaningful(ledger.identities[key]))) {
    blockers.push('Record all six pseudonymous identities with exact role keys');
  } else if (new Set(Object.values(ledger.identities)).size!==requiredActors.length) {
    blockers.push('All 6 test actor identities must be distinct');
  }
  const expectedById=new Map(expected.map(s=>[s.id,s]));
  const incoming=Array.isArray(ledger.tests)?ledger.tests:[];
  if (incoming.length!==expected.length || new Set(incoming.map(s=>s?.id)).size!==expected.length ||
      !expected.every(s=>incoming.some(row=>row?.id===s.id))) {
    blockers.push('Mandatory journey/tenant checks missing or duplicated');
  }
  let passed=0,needsFix=0,blocked=0,notRun=0;
  const observations=[];
  const usedEvidence=[safety?.evidenceRef,ledger.signoff?.privateEvidenceRef].filter(Boolean);
  for (const scenario of incoming) {
    const canonical=expectedById.get(scenario?.id);
    if (!canonical) {blockers.push('Unrecognized test ID');continue;}
    if (scenario.tenant!==canonical.tenant || scenario.performerRole!==canonical.performerRole ||
        scenario.expected!==canonical.expected) {
      blockers.push('Modified expected control: '+scenario.id);
    }
    if (!ALLOWED_STATUS.has(scenario.observedStatus)) {
      blockers.push('Invalid status: '+scenario.id);continue;
    }
    const observed=scenario.observedStatus==='PASS' || scenario.observedStatus==='NEEDS_FIX';
    if (observed) {
      observations.push(scenario);
      usedEvidence.push(scenario.evidenceRef);
      if (!validDate(scenario.observedAtUtc) || !meaningful(scenario.observedBy) ||
          !EVIDENCE_REF.test(scenario.evidenceRef||'') ||
          !meaningful(scenario.independentReviewer) ||
          scenario.independentReviewer===scenario.observedBy) {
        blockers.push('Observed row missing dated observation, private evidence and distinct reviewer: '+scenario.id);
      }
      if (validDate(scenario.observedAtUtc) && validDate(safety?.verifiedAtUtc) &&
          Date.parse(scenario.observedAtUtc)<Date.parse(safety.verifiedAtUtc)) {
        blockers.push('Observed row predates running-app safety verification: '+scenario.id);
      }
      if (meaningful(scenario.blockerCode)) blockers.push('Observed row carries a blocker code: '+scenario.id);
      if (scenario.observedStatus==='PASS') {
        passed++;
        if (meaningful(scenario.defectRef)) blockers.push('PASS has unresolved defect: '+scenario.id);
      } else {
        needsFix++;
        if (!DEFECT_REF.test(scenario.defectRef||'')) blockers.push('NEEDS_FIX requires opaque BUG- defect ID: '+scenario.id);
      }
    } else if (scenario.observedStatus==='BLOCKED') {
      blocked++;
      if (!BLOCKER_CODES.has(scenario.blockerCode)) blockers.push('BLOCKED requires an approved blocker code: '+scenario.id);
      if (['observedAtUtc','observedBy','evidenceRef','independentReviewer','defectRef']
          .some(key=>meaningful(scenario[key]))) blockers.push('BLOCKED cannot contain claimed observation: '+scenario.id);
    } else {
      notRun++;
      if (['observedAtUtc','observedBy','evidenceRef','independentReviewer','defectRef','blockerCode']
          .some(key=>meaningful(scenario[key]))) blockers.push('NOT_RUN cannot contain stale observation: '+scenario.id);
    }
  }
  if (usedEvidence.length!==new Set(usedEvidence).size) blockers.push('Duplicate private evidence reference');
  const operators=new Set(observations.map(row=>row.observedBy));
  if (meaningful(safety?.verifierRef) &&
      (operators.has(safety.verifierRef) || Object.values(ledger.identities||{}).includes(safety.verifierRef))) {
    blockers.push('Runtime safety verifier must be independent of test operators');
  }
  for (const row of observations) {
    if (operators.has(row.independentReviewer)) {
      blockers.push('Independent reviewer cannot be another test operator: '+row.id);
    }
  }
  if (!ledger.signoff || !meaningful(ledger.signoff.independentReviewerId) ||
      !validDate(ledger.signoff.signedAtUtc) ||
      !EVIDENCE_REF.test(ledger.signoff.privateEvidenceRef||'')) {
    blockers.push('Independent reviewer human signoff evidence not supplied');
  }
  if (validDate(ledger.signoff?.signedAtUtc)) {
    const signedAt=Date.parse(ledger.signoff.signedAtUtc);
    if (validDate(safety?.verifiedAtUtc) && signedAt<Date.parse(safety.verifiedAtUtc)) {
      blockers.push('Human signoff predates verified runtime safety');
    }
    if (observations.some(s=>validDate(s.observedAtUtc) && Date.parse(s.observedAtUtc)>signedAt)) {
      blockers.push('Human signoff predates an observation');
    }
    if (operators.has(ledger.signoff.independentReviewerId)) {
      blockers.push('Final independent reviewer cannot sign off their own operator observations');
    }
    if (observations.length && !observations.some(s=>s.independentReviewer===ledger.signoff.independentReviewerId)) {
      blockers.push('Final reviewer is not recorded among independent observation reviewers');
    }
  }
  const ready=passed===expected.length && needsFix===0 && blocked===0 && notRun===0 && blockers.length===0;
  return {
    verdict:ready?'SELF_REPORTED_COMPLETE_REQUIRES_EXTERNAL_VERIFICATION':'NOT_READY',
    total:expected.length,passed,needsFix,blocked,notRun,
    problems:[...new Set(blockers)],
    note:'This tool cannot witness, authenticate or certify actual human activity. Private primary evidence must be independently examined; #853 remains NO-GO without external acceptance.',
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
    // An outside-repository symlink must not redirect private evidence into the checkout.
    outsideWorkingDir(resolve(await realpath(dirname(path)),'private-ledger.json'));
    await writeFile(path,JSON.stringify(ledger,null,2)+'\n',{flag:'wx',mode:0o600});
    process.stdout.write(`CREATED_PRIVATE_LEDGER\nScenarios: ${ledger.tests.length}\nAll statuses: NOT_RUN\n`);
  } else {
    outsideWorkingDir(await realpath(path));
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
