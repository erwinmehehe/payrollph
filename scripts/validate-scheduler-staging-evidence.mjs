#!/usr/bin/env node
/**
 * Offline structure-only check of the OFF -> ON -> OFF scheduler staging witness.
 * This validator NEVER calls GitHub, staging, payroll, Vercel, or another API.
 * Genuine run outcomes and independent approvals must still be verified manually.
 */
import { constants, openSync, closeSync, fstatSync, readSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_EVIDENCE_BYTES = 16 * 1024;
const REPO = 'erwinmehehe/payrollph';
const PHASES = ['disabled', 'enabled', 'disabled'];
const ROOT_KEYS = ['schemaVersion', 'repository', 'environment', 'deploymentSha', 'observations'];
const WITNESS_KEYS = [
  'phase', 'runUrl', 'observedAt', 'deploymentSha', 'deploymentEnvironment',
  'httpStatus', 'schedulerState', 'runConclusion',
];

export class InvalidEvidence extends Error {
  constructor(code) {
    super(code);
    this.name = 'InvalidEvidence';
    this.code = code;
  }
}

function reject(code) { throw new InvalidEvidence(code); }

function hasOnlyKeys(value, allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const found = Object.keys(value);
  return found.length === allowedKeys.length &&
    found.every((key) => allowedKeys.includes(key)) &&
    allowedKeys.every((key) => Object.hasOwn(value, key));
}

function isSha(value) { return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value); }

function parseUtcTimestamp(value) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    reject('INVALID_OBSERVATION_TIMESTAMP');
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
    reject('INVALID_OBSERVATION_TIMESTAMP');
  }
  return time;
}

export function validateEvidence(evidence) {
  if (!hasOnlyKeys(evidence, ROOT_KEYS)) reject('INVALID_ROOT_SCHEMA');
  if (evidence.schemaVersion !== 1 || evidence.repository !== REPO ||
      evidence.environment !== 'payroll-staging') reject('INVALID_REPOSITORY_OR_ENVIRONMENT');
  if (!isSha(evidence.deploymentSha)) reject('INVALID_DEPLOYMENT_SHA');
  if (!Array.isArray(evidence.observations) || evidence.observations.length !== 3) {
    reject('REQUIRES_THREE_OBSERVATIONS');
  }

  const runIds = new Set();
  let lastTimestamp = -Infinity;
  let firstTimestamp = 0;
  let deploymentEnvironment = null;
  for (let i = 0; i < PHASES.length; i++) {
    const item = evidence.observations[i];
    if (!hasOnlyKeys(item, WITNESS_KEYS)) reject('INVALID_OBSERVATION_SCHEMA');
    if (item.phase !== PHASES[i]) reject('INVALID_PHASE_SEQUENCE');
    if (!isSha(item.deploymentSha) || item.deploymentSha !== evidence.deploymentSha) {
      reject('DEPLOYMENT_MISMATCH');
    }
    if (!['preview', 'staging'].includes(item.deploymentEnvironment)) {
      reject('PRODUCTION_OR_UNKNOWN_DEPLOYMENT');
    }
    if (deploymentEnvironment === null) deploymentEnvironment = item.deploymentEnvironment;
    else if (item.deploymentEnvironment !== deploymentEnvironment) {
      reject('INCONSISTENT_DEPLOYMENT_ENVIRONMENT');
    }
    if (item.runConclusion !== 'success') reject('UNSUCCESSFUL_OBSERVATION_RUN');

    const runMatch = typeof item.runUrl === 'string' && item.runUrl.match(
      /^https:\/\/github\.com\/erwinmehehe\/payrollph\/actions\/runs\/([1-9][0-9]{0,18})$/
    );
    if (!runMatch) reject('INVALID_GITHUB_RUN_REFERENCE');
    if (runIds.has(runMatch[1])) reject('DUPLICATE_GITHUB_RUN');
    runIds.add(runMatch[1]);

    const t = parseUtcTimestamp(item.observedAt);
    if (t > Date.now() + 5 * 60 * 1000) reject('FUTURE_OBSERVATION_TIMESTAMP');
    if (t <= lastTimestamp) reject('NON_CHRONOLOGICAL_OBSERVATIONS');
    if (i === 0) firstTimestamp = t;
    lastTimestamp = t;
    if (i === 0 || i === 2) {
      if (item.httpStatus !== 503 || item.schedulerState !== 'scheduler-disabled') {
        reject('DISABLED_PHASE_NOT_VERIFIED');
      }
    } else if (item.httpStatus !== 200 || item.schedulerState !== 'healthy') {
      reject('ENABLED_PHASE_NOT_VERIFIED');
    }
  }
  if (lastTimestamp - firstTimestamp > 24 * 60 * 60 * 1000) {
    reject('REHEARSAL_EXCEEDS_24_HOURS');
  }
  return { valid: true, observations: 3 };
}

/** Read a bounded regular file from ONE descriptor. Do not follow final symlinks. */
export function readEvidenceFile(path) {
  if (typeof path !== 'string' || !path || path.includes('\u0000')) reject('INVALID_EVIDENCE_PATH');
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    if (!fstatSync(fd).isFile()) reject('EVIDENCE_NOT_REGULAR_FILE');
    const buffer = Buffer.alloc(MAX_EVIDENCE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = readSync(fd, buffer, length, buffer.length - length, null);
      if (read === 0) break;
      length += read;
    }
    if (length === 0) reject('EMPTY_EVIDENCE_FILE');
    if (length > MAX_EVIDENCE_BYTES) reject('EVIDENCE_FILE_OVERSIZED');
    try { return JSON.parse(buffer.toString('utf8', 0, length)); }
    catch { reject('EVIDENCE_NOT_JSON'); }
  } catch (e) {
    if (e instanceof InvalidEvidence) throw e;
    reject('EVIDENCE_FILE_CANNOT_BE_READ');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function validateEvidenceFile(path) {
  return validateEvidence(readEvidenceFile(path));
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  try {
    if (process.argv.length !== 3) reject('USAGE_REQUIRES_ONE_JSON_FILE');
    validateEvidenceFile(process.argv[2]);
    console.log('PASS: 3 structurally valid OFF-ON-OFF staging observations.');
    console.log('NOT APPROVED: Independently verify GitHub runs, deployment, reviewers and worker behavior.');
  } catch (error) {
    // Never print evidence, path, raw remote response, secrets, or stack traces.
    const code = error instanceof InvalidEvidence ? error.code : 'UNEXPECTED_VALIDATION_ERROR';
    console.error('FAIL: ' + code);
    process.exitCode = 1;
  }
}
