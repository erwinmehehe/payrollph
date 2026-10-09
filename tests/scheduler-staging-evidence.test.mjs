import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  InvalidEvidence, readEvidenceFile, validateEvidence, validateEvidenceFile,
} from '../scripts/validate-scheduler-staging-evidence.mjs';

const scriptPath = fileURLToPath(new URL('../scripts/validate-scheduler-staging-evidence.mjs', import.meta.url));
const sha = 'a'.repeat(40);
const stamp = (hours) => new Date(Date.UTC(2026, 9, 9, hours, 0, 0)).toISOString();
function good() {
  return {
    schemaVersion: 1, repository: 'erwinmehehe/payrollph', environment: 'payroll-staging',
    deploymentSha: sha, observations: [
      { phase: 'disabled', runUrl:'https://github.com/erwinmehehe/payrollph/actions/runs/1001',
        observedAt:stamp(1), deploymentSha:sha, deploymentEnvironment:'preview',
        httpStatus:503, schedulerState:'scheduler-disabled', runConclusion:'success' },
      { phase: 'enabled', runUrl:'https://github.com/erwinmehehe/payrollph/actions/runs/1002',
        observedAt:stamp(2), deploymentSha:sha, deploymentEnvironment:'preview',
        httpStatus:200, schedulerState:'healthy', runConclusion:'success' },
      { phase: 'disabled', runUrl:'https://github.com/erwinmehehe/payrollph/actions/runs/1003',
        observedAt:stamp(3), deploymentSha:sha, deploymentEnvironment:'preview',
        httpStatus:503, schedulerState:'scheduler-disabled', runConclusion:'success' },
    ],
  };
}
function errorCode(evidence, code) {
  assert.throws(() => validateEvidence(evidence), (error) =>
    error instanceof InvalidEvidence && error.code === code);
}

test('valid three-phase synthetic manifest passes structure checks', () => {
  assert.deepEqual(validateEvidence(good()), {valid:true,observations:3});
});
test('refuses incomplete, reordered or duplicated observations', () => {
  const short = good(); short.observations.pop(); errorCode(short, 'REQUIRES_THREE_OBSERVATIONS');
  const wrong = good(); wrong.observations[1].phase='disabled'; errorCode(wrong,'INVALID_PHASE_SEQUENCE');
  const reused = good(); reused.observations[1].runUrl=reused.observations[0].runUrl;
  errorCode(reused,'DUPLICATE_GITHUB_RUN');
});
test('requires one exact nonproduction deployed SHA for all phases', () => {
  const wrong = good(); wrong.observations[1].deploymentSha='b'.repeat(40);
  errorCode(wrong,'DEPLOYMENT_MISMATCH');
  const production = good(); production.observations[0].deploymentEnvironment='production';
  errorCode(production,'PRODUCTION_OR_UNKNOWN_DEPLOYMENT');
});
test('requires a single consistent deployment environment for all three phases', () => {
  const mixed = good(); mixed.observations[1].deploymentEnvironment = 'staging';
  errorCode(mixed, 'INCONSISTENT_DEPLOYMENT_ENVIRONMENT');
});
test('refuses observation timestamps more than five minutes in the future', () => {
  const future = good(); future.observations[2].observedAt = new Date(Date.now() + 3600000).toISOString();
  errorCode(future, 'FUTURE_OBSERVATION_TIMESTAMP');
});
test('does not accept healthy-looking disabled results or unhealthy enabled results', () => {
  const fakeOff = good(); fakeOff.observations[2].httpStatus=200;
  errorCode(fakeOff,'DISABLED_PHASE_NOT_VERIFIED');
  const fakeOn = good(); fakeOn.observations[1].schedulerState='last-run-failed';
  errorCode(fakeOn,'ENABLED_PHASE_NOT_VERIFIED');
});
test('rejects untrusted run URL origins, query parameters and userinfo', () => {
  for (const url of [
    'https://github.evil.test/erwinmehehe/payrollph/actions/runs/123',
    'https://github.com/erwinmehehe/payrollph/actions/runs/123?token=x',
    'https://user:password@github.com/erwinmehehe/payrollph/actions/runs/123',
    'http://github.com/erwinmehehe/payrollph/actions/runs/123',
  ]) {
    const record = good(); record.observations[1].runUrl=url;
    errorCode(record,'INVALID_GITHUB_RUN_REFERENCE');
  }
});
test('time order and 24-hour single-rehearsal window are enforced', () => {
  const back = good(); back.observations[1].observedAt=stamp(0);
  errorCode(back,'NON_CHRONOLOGICAL_OBSERVATIONS');
  const tooLong = good(); tooLong.observations[0].observedAt='2026-10-07T01:00:00.000Z';
  tooLong.observations[1].observedAt='2026-10-08T02:00:00.000Z';
  errorCode(tooLong,'REHEARSAL_EXCEEDS_24_HOURS');
  const malformed = good(); malformed.observations[0].observedAt='2026-10-09';
  errorCode(malformed,'INVALID_OBSERVATION_TIMESTAMP');
});
test('unknown fields cannot smuggle secrets or employee records into evidence manifest', () => {
  const secret = good(); secret.privateKey='do-not-print-this-secret';
  errorCode(secret,'INVALID_ROOT_SCHEMA');
  const person = good(); person.observations[0].employeeName='private-person';
  errorCode(person,'INVALID_OBSERVATION_SCHEMA');
});
test('bounded regular-file reader and CLI emit no input JSON', () => {
  const folder=mkdtempSync(join(tmpdir(),'scheduler-evidence-'));
  const accepted=join(folder,'good.json');
  const oversized=join(folder,'oversized.json');
  const symlink=join(folder,'link.json');
  try {
    writeFileSync(accepted,JSON.stringify(good()));
    assert.deepEqual(validateEvidenceFile(accepted),{valid:true,observations:3});
    assert.deepEqual(readEvidenceFile(accepted),good());
    const output=execFileSync(process.execPath,[scriptPath,accepted],{encoding:'utf8'});
    assert.match(output,/PASS:/);
    assert.match(output,/NOT APPROVED:/);
    assert.ok(!output.includes('actions/runs/1001'));
    writeFileSync(oversized,'x'.repeat(16400));
    assert.throws(()=>readEvidenceFile(oversized),(error)=>error.code==='EVIDENCE_FILE_OVERSIZED');
    symlinkSync(accepted,symlink);
    assert.throws(()=>readEvidenceFile(symlink),(error)=>error.code==='EVIDENCE_FILE_CANNOT_BE_READ');
    const fail=spawnSync(process.execPath,[scriptPath,oversized],{encoding:'utf8'});
    assert.equal(fail.status,1);
    assert.match(fail.stderr,/FAIL: EVIDENCE_FILE_OVERSIZED/);
    assert.ok(!fail.stderr.includes('x'.repeat(10)));
  } finally {
    rmSync(folder,{recursive:true,force:true});
  }
});
