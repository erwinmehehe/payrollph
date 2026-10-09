#!/usr/bin/env node
/**
 * Operator-invoked, read-only GitHub Actions provenance verification.
 * This does not contact staging, read payroll data, or approve a release.
 * The supplied GitHub token must be scoped to Actions:read for the repo.
 */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {InvalidEvidence, readEvidenceFile, validateEvidence} from './validate-scheduler-staging-evidence.mjs';

const API = 'https://api.github.com';
const REPO_PATH = '/repos/erwinmehehe/payrollph';
const WORKFLOW_PATH = '.github/workflows/scheduler-staging-health.yml';
const WORKFLOW_NAME = 'Payroll Scheduler Staging Health (Manual)';
const JOB_NAME = 'read-only-staging-check';
const STEP_NAME = 'Verify protected staging scheduler liveness';
const MAX_API_RESPONSE_BYTES = 512 * 1024;

export class ProvenanceError extends Error {
  constructor(code) {super(code); this.name = 'ProvenanceError'; this.code = code;}
}
function reject(code) {throw new ProvenanceError(code);}
function validSha(value) {return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);}
function parseTime(value) {
  if (typeof value !== 'string') reject('GITHUB_RUN_TIMESTAMPS_INVALID');
  const date = Date.parse(value);
  if (!Number.isFinite(date)) reject('GITHUB_RUN_TIMESTAMPS_INVALID');
  return date;
}
function requireToken(token) {
  if (typeof token !== 'string' || token.length < 20 || /\s/.test(token)) {
    reject('GITHUB_ACTIONS_READ_TOKEN_REQUIRED');
  }
}

async function githubJson(path, token, fetcher) {
  // path is composed exclusively from validated decimal IDs or a fixed suffix.
  if (!/^\/repos\/erwinmehehe\/payrollph\/actions\/(?:runs\/[1-9]\d{0,18}(?:\/jobs\?per_page=10)?|workflows\/[1-9]\d{0,18})$/.test(path)) {
    reject('UNSAFE_GITHUB_API_PATH');
  }
  let response;
  try {
    response = await fetcher(API + path, {
      method: 'GET',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
  } catch {reject('GITHUB_READ_FAILED');}
  if (response.status !== 200 ||
      !response.headers?.get('content-type')?.includes('application/json')) {
    reject('GITHUB_RUN_LOOKUP_FAILED');
  }
  let body;
  try {
    // Bound bytes WHILE reading the GitHub response. Calling response.text()
    // first could allocate an arbitrarily large untrusted payload.
    const declaredLength = response.headers.get('content-length');
    if (declaredLength !== null &&
        (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_API_RESPONSE_BYTES)) {
      reject('GITHUB_API_RESPONSE_OVERSIZED');
    }
    if (!response.body || typeof response.body.getReader !== 'function') {
      reject('GITHUB_API_RESPONSE_INVALID');
    }
    const reader = response.body.getReader();
    const chunks = [];
    let count = 0;
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        if (!(value instanceof Uint8Array)) reject('GITHUB_API_RESPONSE_INVALID');
        count += value.byteLength;
        if (count > MAX_API_RESPONSE_BYTES) {
          await reader.cancel();
          reject('GITHUB_API_RESPONSE_OVERSIZED');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    body = JSON.parse(Buffer.concat(chunks, count).toString('utf8'));
  } catch (error) {
    if (error instanceof ProvenanceError) throw error;
    reject('GITHUB_API_RESPONSE_INVALID');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    reject('GITHUB_API_RESPONSE_INVALID');
  }
  return body;
}

export async function verifyRunProvenance(evidence, {token, fetcher = fetch} = {}) {
  validateEvidence(evidence); // Strict local whitelist and ordered witness proof first.
  requireToken(token);
  let workflowHeadSha = null;
  for (const item of evidence.observations) {
    const match = item.runUrl.match(/\/actions\/runs\/([1-9][0-9]{0,18})$/);
    const runId = match[1]; // Guaranteed by validateEvidence.
    const run = await githubJson(REPO_PATH + '/actions/runs/' + runId, token, fetcher);
    if (String(run.id) !== runId || run.name !== WORKFLOW_NAME ||
        run.event !== 'workflow_dispatch' || run.head_branch !== 'main' ||
        run.status !== 'completed' || run.conclusion !== 'success' ||
        run.run_attempt !== 1 ||
        !Number.isSafeInteger(run.workflow_id) || run.workflow_id <= 0 ||
        !validSha(run.head_sha) ||
        ![WORKFLOW_PATH, WORKFLOW_PATH + '@refs/heads/main'].includes(run.path)) {
      reject('GITHUB_RUN_PROVENANCE_MISMATCH');
    }
    if (workflowHeadSha === null) workflowHeadSha = run.head_sha;
    else if (workflowHeadSha !== run.head_sha) reject('GITHUB_WORKFLOW_REVISION_CHANGED');
    // GitHub may expose workflow_dispatch inputs on the run object. When
    // present, the actual selected mode must match the operator manifest.
    // A missing inputs object does NOT establish phase provenance.
    if (run.inputs != null &&
        (!run.inputs || typeof run.inputs !== 'object' || Array.isArray(run.inputs) ||
          run.inputs.expected_scheduler_state !== item.phase)) {
      reject('GITHUB_DISPATCH_PHASE_MISMATCH');
    }

    const start = parseTime(run.run_started_at);
    const end = parseTime(run.updated_at);
    const observed = Date.parse(item.observedAt);
    if (end < start || observed < start - 5 * 60000 || observed > end + 5 * 60000) {
      reject('GITHUB_RUN_TIMESTAMP_MISMATCH');
    }

    const workflow = await githubJson(REPO_PATH + '/actions/workflows/' + run.workflow_id, token, fetcher);
    if (workflow.name !== WORKFLOW_NAME || workflow.path !== WORKFLOW_PATH) {
      reject('GITHUB_WORKFLOW_IDENTITY_MISMATCH');
    }
    const jobs = await githubJson(REPO_PATH + '/actions/runs/' + runId + '/jobs?per_page=10', token, fetcher);
    if (!Number.isSafeInteger(jobs.total_count) || jobs.total_count > 10 ||
        !Array.isArray(jobs.jobs)) reject('GITHUB_JOB_LIST_INVALID');
    const matching = jobs.jobs.filter(job => job.name === JOB_NAME);
    if (matching.length !== 1 || String(matching[0].run_id) !== runId ||
        matching[0].head_sha !== run.head_sha ||
        matching[0].status !== 'completed' ||
        matching[0].conclusion !== 'success' ||
        !Array.isArray(matching[0].steps) ||
        !matching[0].steps.some(step => step.name === STEP_NAME &&
          step.status === 'completed' && step.conclusion === 'success')) {
      reject('GITHUB_MONITOR_JOB_NOT_PROVEN');
    }
  }
  return {verifiedRunMetadata: 3, verifiedMonitorJobs: 3, independentApprovalStillRequired: true};
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  (async () => {
    if (process.argv.length !== 3) reject('USAGE_REQUIRES_ONE_JSON_FILE');
    // Use one bounded file read; never validate one file version then
    // authenticate a potentially different version after a path swap.
    const manifest = readEvidenceFile(process.argv[2]);
    await verifyRunProvenance(manifest, {token: process.env.GH_TOKEN});
    console.log('PASS: 3 GitHub workflow runs and monitor job results match the manifest.');
    console.log('NOT APPROVED: Verify run input phases, protected environment approvals, deployed SHA, live worker and reviewer sign-offs independently.');
  })().catch(error => {
    // No raw responses, tokens, file paths or stack traces in operator output.
    const code = error instanceof ProvenanceError || error instanceof InvalidEvidence
      ? error.code : 'GITHUB_PROVENANCE_UNEXPECTED_ERROR';
    console.error('FAIL: ' + code);
    process.exitCode = 1;
  });
}
