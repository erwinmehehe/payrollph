import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  WFM_CASES, createWfmWitnessTemplate, evaluateWfmWitnessPacket,
} from '../scripts/qa/wfm-independent-witness.mjs';

const SHA = 'a'.repeat(40);
const witness = id => {
  const packet = createWfmWitnessTemplate(SHA);
  packet.deployedSha = SHA;
  packet.payoutsDisabled = true;
  packet.agencySubmissionDisabled = true;
  const role = WFM_CASES.find(([key]) => key === id)[1];
  packet.cases[id] = {
    ...packet.cases[id], status: 'PASS', reviewerRole: role,
    reviewerRef: 'REV-PRIVATE012',
    evidenceRef: 'UAT-PRIVATE012',
    expected: 'Observed expected tenant and role boundary',
    observed: 'Actually saw the expected restricted result',
    observedAt: '2026-10-13T08:00:00Z',
    ...(new Set(['WFM-04','WFM-07','WFM-08','WFM-09']).has(id)
      ? { makerRef: 'REV-PRIVATE099', checkerRef: 'REV-PRIVATE012' } : {}),
    ...(id === 'WFM-14'
      ? { deviceModelRef: 'DEVICE-PRIVATE010', physicalDeviceWitnessed: true } : {}),
  };
  return packet;
};

test('template holds exactly fourteen NOT_RUN cases, never claims acceptance', () => {
  const packet = createWfmWitnessTemplate(SHA);
  const result = evaluateWfmWitnessPacket(packet);
  assert.equal(WFM_CASES.length, 14);
  assert.deepEqual(result.counts, { NOT_RUN:14, PASS:0, NEEDS_FIX:0, BLOCKED:0 });
  assert.equal(result.independentHumanApproval, 'NOT_VERIFIED');
  assert.equal(result.physicalDeviceCertification, 'NOT_VERIFIED');
  assert.equal(result.payoutsOrAgencyAuthorized, false);
  assert.equal(packet.deployedSha, null, 'The template cannot pre-attest a deployed build');
  assert.equal(packet.payoutsDisabled, null, 'Payout isolation must be checked by an operator');
  assert.equal(packet.agencySubmissionDisabled, null, 'Agency isolation must be checked by an operator');
  assert.equal(result.runtimeConfigurationSelfReported, false);
});

test('one claimed observation requires discipline, timestamp, expectation, actual and evidence', () => {
  const packet = witness('WFM-01');
  assert.equal(evaluateWfmWitnessPacket(packet).counts.PASS, 1);
  for (const [field, value] of [['reviewerRole','HR'], ['evidenceRef',''],
    ['observed',''], ['expected',''], ['observedAt','2030-10-13']]) {
    assert.throws(() => evaluateWfmWitnessPacket({ ...packet, cases:{...packet.cases,
      'WFM-01': {...packet.cases['WFM-01'], [field]:value} } }));
  }
});

test('maker/checker cannot be the same for conflict, payroll and approval scenarios', () => {
  for (const id of ['WFM-04','WFM-07','WFM-08','WFM-09']) {
    const packet = witness(id);
    assert.equal(evaluateWfmWitnessPacket(packet).counts.PASS, 1);
    packet.cases[id].checkerRef = packet.cases[id].makerRef;
    assert.throws(() => evaluateWfmWitnessPacket(packet), /maker and checker must differ/);
  }
});

test('physical biometric acceptance cannot be synthesized with WFM-14 evidence ID alone', () => {
  const packet = witness('WFM-14');
  assert.equal(evaluateWfmWitnessPacket(packet).physicalDeviceSelfReported, true);
  packet.cases['WFM-14'].physicalDeviceWitnessed = false;
  assert.throws(() => evaluateWfmWitnessPacket(packet), /cannot PASS through simulation/);
  packet.cases['WFM-14'].status = 'BLOCKED';
  packet.cases['WFM-14'].blockerCode = 'DEVICE';
  for (const key of ['expected','observed','observedAt','evidenceRef','reviewerRef','deviceModelRef']) packet.cases['WFM-14'][key] = '';
  packet.cases['WFM-14'].physicalDeviceWitnessed = false;
  assert.equal(evaluateWfmWitnessPacket(packet).counts.BLOCKED, 1);
});

test('a fabricated external acceptance claim or partially omitted cases fails closed', () => {
  const packet = createWfmWitnessTemplate(SHA);
  assert.throws(() => evaluateWfmWitnessPacket({ ...packet, independentHumanAccepted:true }), /External approval/);
  assert.throws(() => evaluateWfmWitnessPacket({ ...packet, deployedSha:'b'.repeat(40) }), /must match/);
  delete packet.cases['WFM-10'];
  assert.throws(() => evaluateWfmWitnessPacket(packet), /All fourteen/);
});

test('all fourteen populated cases produce only a record pending real reviewer verification', () => {
  const packet = createWfmWitnessTemplate(SHA);
  for(const [id] of WFM_CASES) packet.cases[id] = witness(id).cases[id];
  // Structural completeness is still blocked until the operator records the
  // actual deployment and disabled payment/agency flags.
  assert.equal(evaluateWfmWitnessPacket(packet).status, 'INCOMPLETE_NOT_ACCEPTED');
  packet.deployedSha = SHA;
  packet.payoutsDisabled = true;
  packet.agencySubmissionDisabled = true;
  const result = evaluateWfmWitnessPacket(packet);
  assert.equal(result.status, 'RECORDED_PENDING_HUMAN_VALIDATION');
  assert.equal(result.independentHumanApproval, 'NOT_VERIFIED');
  assert.equal(result.physicalDeviceCertification, 'NOT_VERIFIED');
  assert.equal(result.p0Recorded, true);
});

test('unverified runtime flags fail closed even when all fourteen cases claim PASS', () => {
  const packet = createWfmWitnessTemplate(SHA);
  for (const [id] of WFM_CASES) packet.cases[id] = witness(id).cases[id];
  packet.deployedSha = SHA;
  assert.equal(evaluateWfmWitnessPacket(packet).p0Recorded, false);
  packet.payoutsDisabled = true;
  assert.equal(evaluateWfmWitnessPacket(packet).status, 'INCOMPLETE_NOT_ACCEPTED');
  packet.agencySubmissionDisabled = false;
  assert.throws(() => evaluateWfmWitnessPacket(packet), /Runtime safety flags/);
  packet.agencySubmissionDisabled = true;
  assert.equal(evaluateWfmWitnessPacket(packet).status, 'RECORDED_PENDING_HUMAN_VALIDATION');
  // An internally consistent packet is never authenticated human approval.
  assert.equal(evaluateWfmWitnessPacket(packet).independentHumanApproval, 'NOT_VERIFIED');
});

test('CLI reads local packet and prints redacted summary, not private observation strings', () => {
  const path = fileURLToPath(new URL('../scripts/qa/wfm-independent-witness.mjs', import.meta.url));
  const root = mkdtempSync(join(tmpdir(), 'wfm-independent-'));
  try {
    const packet = createWfmWitnessTemplate(SHA);
    const evidencePath = join(root, 'witness.json');
    writeFileSync(evidencePath, JSON.stringify(packet));
    const result = spawnSync(process.execPath, [path, 'verify', evidencePath], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    const j = JSON.parse(result.stdout);
    assert.equal(j.status, 'INCOMPLETE_NOT_ACCEPTED');
    assert.equal(result.stdout.includes(evidencePath), false);
    const template = spawnSync(process.execPath, [path, 'template', SHA], { encoding: 'utf8' });
    assert.equal(template.status, 0);
    assert.equal(JSON.parse(template.stdout).cases['WFM-14'].status, 'NOT_RUN');
  } finally { rmSync(root, { recursive:true, force:true }); }
});


test('CLI refuses symlink and oversized private packet without exposing paths or content', () => {
  const script = fileURLToPath(new URL('../scripts/qa/wfm-independent-witness.mjs', import.meta.url));
  const root = mkdtempSync(join(tmpdir(), 'wfm-private-boundary-'));
  try {
    const regular = join(root, 'private-original.json');
    const symlink = join(root, 'private-link.json');
    const oversized = join(root, 'oversize-private.json');
    writeFileSync(regular, JSON.stringify(createWfmWitnessTemplate(SHA)));
    symlinkSync(regular, symlink);
    writeFileSync(oversized, 'X'.repeat(256 * 1024 + 1));
    for (const file of [symlink, oversized]) {
      const out = spawnSync(process.execPath, [script, 'verify', file], { encoding: 'utf8' });
      assert.equal(out.status, 2);
      assert.ok(!out.stderr.includes(root), 'Private evidence directory must never be exposed');
      assert.match(out.stderr, /Witness packet check failed/);
      assert.equal(out.stdout, '');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
