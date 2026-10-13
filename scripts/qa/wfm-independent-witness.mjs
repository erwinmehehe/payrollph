import assert from 'node:assert/strict';
import { openSync, closeSync, fstatSync, readSync, constants } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Offline WFM-01..14 witness packet integrity checker. It does not run UAT,
 * authenticate witnesses, sign evidence, move funds, or certify hardware.
 * Reviewers retain actual observations and their identity mapping privately.
 */
export const WFM_CASES = Object.freeze([
  ['WFM-01', 'SECURITY'],
  ['WFM-02', 'SECURITY'],
  ['WFM-03', 'OPERATIONS'],
  ['WFM-04', 'OPERATIONS'],
  ['WFM-05', 'HR'],
  ['WFM-06', 'PAYROLL'],
  ['WFM-07', 'PAYROLL'],
  ['WFM-08', 'PAYROLL'],
  ['WFM-09', 'SECURITY'],
  ['WFM-10', 'SRE'],
  ['WFM-11', 'UX'],
  ['WFM-12', 'SRE'],
  ['WFM-13', 'UX'],
  ['WFM-14', 'DEVICE'],
]);

const SHA = /^[a-f0-9]{40}$/;
const EVIDENCE = /^UAT-[A-Z0-9][A-Z0-9-]{2,79}$/;
const PERSON = /^REV-[A-Z0-9][A-Z0-9-]{2,79}$/;
const DEFECT = /^BUG-[A-Z0-9][A-Z0-9-]{1,79}$/;
const MODEL = /^DEVICE-[A-Z0-9][A-Z0-9-]{2,79}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const STATES = new Set(['NOT_RUN', 'PASS', 'NEEDS_FIX', 'BLOCKED']);
const BLOCKERS = new Set(['DEVICE', 'REVIEWER', 'DATA', 'ROLE', 'ENVIRONMENT', 'OTHER']);
const SEPARATE_ACTORS = new Set(['WFM-04', 'WFM-07', 'WFM-08', 'WFM-09']);
const TEXT_LIMIT = 1600;
const empty = () => ({ status: 'NOT_RUN', reviewerRole: '', reviewerRef: '', makerRef: '', checkerRef: '',
  expected: '', observed: '', evidenceRef: '', defectRef: '', blockerCode: '', observedAt: '',
  deviceModelRef: '', physicalDeviceWitnessed: false });

export function createWfmWitnessTemplate(sha) {
  assert.match(sha, SHA, 'Exact 40-character SHA required');
  return {
    version: 1,
    purpose: 'fictional-development-wfm-witness',
    sourceSha: sha,
    deployedSha: sha,
    fictionalRecordsOnly: true,
    payoutsDisabled: true,
    agencySubmissionDisabled: true,
    cases: Object.fromEntries(WFM_CASES.map(([id]) => [id, empty()])),
  };
}

const validText = x => typeof x === 'string' && x.trim().length >= 8 && x.length <= TEXT_LIMIT;
const blank = x => x === '' || x === false;

/**
 * Checks structure and supplied evidence references, not actual observations.
 * The result never elevates source tests or self-attestations to human approval.
 */
export function evaluateWfmWitnessPacket(packet) {
  assert.ok(packet && typeof packet === 'object' && !Array.isArray(packet), 'Invalid witness packet');
  assert.equal(packet.version, 1, 'Unrecognized witness packet version');
  assert.equal(packet.purpose, 'fictional-development-wfm-witness', 'Fictional development scope required');
  assert.match(packet.sourceSha ?? '', SHA, 'Invalid source SHA');
  assert.match(packet.deployedSha ?? '', SHA, 'Invalid deployed SHA');
  assert.equal(packet.sourceSha, packet.deployedSha, 'Deployed build and source must match');
  assert.equal(packet.fictionalRecordsOnly, true, 'This tool is restricted to fictional data');
  assert.equal(packet.payoutsDisabled, true, 'Payout providers must be disabled');
  assert.equal(packet.agencySubmissionDisabled, true, 'Agency submissions must be disabled');
  for (const claim of ['independentHumanAccepted', 'productionAuthorized', 'hardwareCertified', 'moneyMoved', 'agencyAccepted']) {
    assert.notEqual(packet[claim], true, 'External approval may not be asserted: ' + claim);
  }
  assert.ok(packet.cases && typeof packet.cases === 'object' && !Array.isArray(packet.cases), 'Missing cases');
  const keys = Object.keys(packet.cases);
  assert.equal(keys.length, WFM_CASES.length, 'All fourteen canonical cases are required');
  const counts = { NOT_RUN: 0, PASS: 0, NEEDS_FIX: 0, BLOCKED: 0 };
  let physicalDeviceSelfReported = false;
  for (const [id, requiredRole] of WFM_CASES) {
    const outcome = packet.cases[id];
    assert.ok(outcome && typeof outcome === 'object' && !Array.isArray(outcome), 'Missing canonical scenario ' + id);
    assert.ok(STATES.has(outcome.status), 'Invalid status for ' + id);
    counts[outcome.status]++;
    if (outcome.status === 'NOT_RUN') {
      for (const key of ['reviewerRole', 'reviewerRef', 'makerRef', 'checkerRef', 'expected', 'observed',
        'evidenceRef', 'defectRef', 'blockerCode', 'observedAt', 'deviceModelRef', 'physicalDeviceWitnessed']) {
        assert.ok(blank(outcome[key]), id + ': NOT_RUN must not contain alleged observations');
      }
      continue;
    }
    if (outcome.status === 'BLOCKED') {
      assert.ok(BLOCKERS.has(outcome.blockerCode), id + ': use a recognized blocker');
      for (const key of ['reviewerRef', 'makerRef', 'checkerRef', 'expected', 'observed',
        'evidenceRef', 'defectRef', 'observedAt', 'deviceModelRef', 'physicalDeviceWitnessed']) {
        assert.ok(blank(outcome[key]), id + ': blocked case cannot claim observations');
      }
      continue;
    }
    assert.equal(outcome.reviewerRole, requiredRole, id + ': required independent review discipline missing');
    assert.match(outcome.reviewerRef ?? '', PERSON, id + ': use opaque reviewer reference');
    assert.match(outcome.evidenceRef ?? '', EVIDENCE, id + ': requires private evidence reference');
    assert.ok(validText(outcome.expected), id + ': record actual test expectation privately');
    assert.ok(validText(outcome.observed), id + ': record observed browser/device outcome privately');
    assert.match(outcome.observedAt ?? '', ISO, id + ': use exact UTC observation timestamp');
    assert.equal(Number.isFinite(Date.parse(outcome.observedAt)), true, id + ': invalid timestamp');
    if (SEPARATE_ACTORS.has(id)) {
      assert.match(outcome.makerRef ?? '', PERSON, id + ': record maker');
      assert.match(outcome.checkerRef ?? '', PERSON, id + ': record checker');
      assert.notEqual(outcome.makerRef, outcome.checkerRef, id + ': maker and checker must differ');
    } else {
      assert.ok(blank(outcome.makerRef) && blank(outcome.checkerRef), id + ': unexpected actors');
    }
    if (outcome.status === 'NEEDS_FIX') {
      assert.match(outcome.defectRef ?? '', DEFECT, id + ': observed failure requires defect reference');
    } else assert.ok(blank(outcome.defectRef), id + ': PASS must not hide an unresolved defect');
    assert.ok(blank(outcome.blockerCode), id + ': disposition cannot also be BLOCKED');
    if (id === 'WFM-14' && outcome.status === 'PASS') {
      assert.match(outcome.deviceModelRef ?? '', MODEL, 'WFM-14 requires a private physical model reference');
      assert.equal(outcome.physicalDeviceWitnessed, true, 'WFM-14 cannot PASS through simulation');
      physicalDeviceSelfReported = true;
    } else {
      assert.ok(blank(outcome.deviceModelRef) && blank(outcome.physicalDeviceWitnessed),
        id + ': physical device attestation is permitted only for WFM-14 PASS');
    }
  }
  return {
    sourceSha: packet.sourceSha,
    status: counts.PASS === 14 ? 'RECORDED_PENDING_HUMAN_VALIDATION' : 'INCOMPLETE_NOT_ACCEPTED',
    total: 14,
    counts,
    p0Recorded: WFM_CASES.slice(0, 10).every(([id]) => packet.cases[id].status === 'PASS'),
    physicalDeviceSelfReported,
    independentHumanApproval: 'NOT_VERIFIED',
    physicalDeviceCertification: 'NOT_VERIFIED',
    realEmployerReconciliation: 'NOT_RUN',
    payoutsOrAgencyAuthorized: false,
    explanation: 'Offline self-supplied packet shape only. Verify witnesses, original private evidence and signatures independently.',
  };
}

// Open the evidence once and read through the same descriptor. No path-level
// check-then-open race, and no unbounded read from an untrusted packet path.
function readPrivateWitnessPacket(path) {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = fstatSync(fd);
    const limit = 256 * 1024;
    if (!before.isFile() || !Number.isSafeInteger(before.size) ||
        before.size <= 0 || before.size > limit) {
      throw new Error('Packet must be a nonempty regular file no larger than 256 KiB');
    }
    const data = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < data.length) {
      const received = readSync(fd, data, offset, data.length - offset, offset);
      if (received === 0) throw new Error('Packet changed while reading');
      offset += received;
    }
    const after = fstatSync(fd);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new Error('Packet changed while reading');
    }
    return JSON.parse(data.toString('utf8'));
  } finally {
    closeSync(fd);
  }
}

function cli() {
  const [command, arg] = process.argv.slice(2);
  if (command === 'template' && arg) {
    process.stdout.write(JSON.stringify(createWfmWitnessTemplate(arg), null, 2) + '\n');
    return;
  }
  if (command === 'verify' && arg && process.argv.length === 4) {
    const packet = readPrivateWitnessPacket(arg);
    const report = evaluateWfmWitnessPacket(packet);
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (report.status !== 'RECORDED_PENDING_HUMAN_VALIDATION') process.exitCode = 1;
    return;
  }
  throw new Error('Usage: node scripts/qa/wfm-independent-witness.mjs template <40-hex-sha> | verify <PRIVATE_PACKET_JSON>');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { cli(); } catch { console.error('Witness packet check failed; check private input and command locally.'); process.exitCode = 2; }
}
