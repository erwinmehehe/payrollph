#!/usr/bin/env node
/**
 * P0-2: read-only GitHub schedule provenance observer.
 * Never contacts a deployment, database, payroll API, or payment provider.
 * A green observer job means evidence collection succeeded, NOT approval to activate.
 */
import {appendFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = 'https://api.github.com/repos/erwinmehehe/payrollph';
const PATH = '.github/workflows/production-scheduler-tick.yml';
const NAME = 'Production Scheduler Tick (External, Default OFF)';
const STEP = 'Dispatch one protected production scheduler tick';
const LIST = ROOT + '/actions/workflows/production-scheduler-tick.yml/runs?event=schedule&branch=main&per_page=100';
const MAX_BYTES = 1024 * 1024;
const MAX_AGE = 24 * 60 * 60 * 1000;
const OUTPUT = 'qa-artifacts/scheduler-scheduled-run-observation.json';
const SHA = /^[0-9a-f]{40}$/;

export class ObserverError extends Error {
  constructor(code) {super(code); this.name = 'ObserverError'; this.code = code;}
}
function reject(code) {throw new ObserverError(code);}
function validTime(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(text)) reject('INVALID_RUN_TIMESTAMP');
  const ms = Date.parse(text);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0,19) !== text.slice(0,19)) reject('INVALID_RUN_TIMESTAMP');
  return ms;
}
function validId(id) {return Number.isSafeInteger(id) && id > 0;}
export function selectScheduledRuns(items, now = new Date()) {
  if (!Array.isArray(items) || items.length > 100 || !Number.isFinite(now.getTime())) reject('INVALID_RUN_LIST');
  const ids = new Set();
  const selected = [];
  for (const run of items) {
    if (!run || !validId(run.id) || ids.has(run.id)) reject('DUPLICATE_OR_INVALID_RUN_ID');
    ids.add(run.id);
    const start = validTime(run.created_at);
    const end = validTime(run.updated_at);
    if (start > now.getTime() + 60000 || end < start || end > now.getTime() + 60000) reject('INVALID_RUN_TIMESTAMP');
    if (now.getTime() - start > MAX_AGE) continue;
    if (run.name !== NAME || run.event !== 'schedule' || run.head_branch !== 'main' ||
        ![PATH, PATH + '@refs/heads/main'].includes(run.path) ||
        !validId(run.workflow_id) || !SHA.test(run.head_sha ?? '') || run.run_attempt !== 1) {
      reject('SCHEDULE_IDENTITY_NOT_VERIFIED');
    }
    selected.push(run);
  }
  selected.sort((a,b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  // Protect against a fabricated stack of nearly simultaneous duplicated schedules.
  const recent = selected.slice(0,3);
  if (recent.length === 3 && recent.some((r,i) => i &&
      Date.parse(recent[i-1].created_at) - Date.parse(r.created_at) < 60000)) {
    reject('SCHEDULE_TIMESPACING_NOT_VERIFIED');
  }
  return recent;
}
export function assessScheduledRunEvidence(runs, jobsByRun, now = new Date()) {
  const selected = selectScheduledRuns(runs, now);
  if (!(jobsByRun instanceof Map)) reject('JOB_EVIDENCE_REQUIRED');
  const observations = [];
  for (const run of selected) {
    const jobs = jobsByRun.get(run.id);
    if (!Array.isArray(jobs) || jobs.length !== 1) reject('TICK_JOB_NOT_VERIFIED');
    const job = jobs[0];
    if (!job || job.name !== 'tick' || job.run_id !== run.id || job.head_sha !== run.head_sha ||
        job.status !== 'completed' || run.status !== 'completed') reject('TICK_JOB_NOT_VERIFIED');
    let outcome;
    if (job.conclusion === 'skipped' && ['skipped','success'].includes(run.conclusion)) {
      outcome = 'dispatch-gated-off';
    } else if (job.conclusion === 'success' && run.conclusion === 'success' &&
        Array.isArray(job.steps) && job.steps.some(s => s.name === STEP &&
        s.status === 'completed' && s.conclusion === 'success')) {
      // A step conclusion is NOT deployed heartbeat evidence or payment authorization.
      outcome = 'dispatch-step-reported-success';
    } else reject('TICK_JOB_RESULT_NOT_VERIFIED');
    observations.push({
      runId: run.id,
      runUrl: ROOT.replace('api.github.com/repos','github.com') + '/actions/runs/' + run.id,
      createdAt: run.created_at,
      sourceSha: run.head_sha,
      outcome,
    });
  }
  const complete = observations.length === 3;
  const allOff = complete && observations.every(x => x.outcome === 'dispatch-gated-off');
  const allReported = complete && observations.every(x => x.outcome === 'dispatch-step-reported-success');
  const state = !observations.length ? 'no-scheduled-runs-in-window'
    : !complete ? 'fewer-than-three-scheduled-runs'
    : allOff ? 'scheduled-events-observed-dispatch-disabled'
    : allReported ? 'dispatch-step-success-heartbeat-unverified'
    : 'mixed-scheduled-results-not-proven';
  return {
    schemaVersion: 1,
    source: 'read-only-github-actions-metadata',
    workflow: PATH,
    observedAt: now.toISOString(),
    state,
    scheduledEventCount: observations.length,
    threeDistinctScheduledEventsProven: complete,
    threeDispatchStepSuccessesProven: allReported,
    deploymentHeartbeatProven: false,
    hostedWorkerHeartbeatProven: false,
    independentMissedTickAlertProven: false,
    payrollReleaseAuthorized: false,
    productionSchedulerActivationAuthorized: false,
    observations,
  };
}

async function githubJson(path, token, fetcher) {
  const url = path === 'list' ? LIST : ROOT + '/actions/runs/' + path + '/jobs?per_page=30';
  if (path !== 'list' && (!/^[1-9]\d{0,14}$/.test(String(path)) || !Number.isSafeInteger(Number(path)))) {
    reject('INVALID_GITHUB_RUN_REFERENCE');
  }
  let response;
  try {
    response = await fetcher(url, {
      method: 'GET', redirect: 'error', cache: 'no-store',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(10000),
    });
  } catch {reject('GITHUB_READ_FAILED');}
  if (response.status !== 200 || !response.headers?.get('content-type')?.includes('application/json')) {
    reject('GITHUB_READ_NOT_AUTHORIZED');
  }
  const len = response.headers.get('content-length');
  if (len !== null && (!/^\d+$/.test(len) || Number(len) > MAX_BYTES)) reject('GITHUB_RESPONSE_OVERSIZED');
  if (!response.body || typeof response.body.getReader !== 'function') reject('GITHUB_BODY_UNAVAILABLE');
  let total = 0; const chunks=[]; const reader = response.body.getReader();
  try {
    for (;;) {
      const {done,value}=await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) reject('GITHUB_BODY_UNAVAILABLE');
      total+=value.byteLength;
      if (total > MAX_BYTES) {await reader.cancel();reject('GITHUB_RESPONSE_OVERSIZED');}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  try {return JSON.parse(Buffer.concat(chunks,total).toString('utf8'));}
  catch {reject('GITHUB_JSON_INVALID');}
}

export async function collectScheduledRunEvidence({token,fetcher=fetch,now=new Date()}={}) {
  if (typeof token !== 'string' || token.length < 20 || /\s/.test(token)) reject('READ_ONLY_ACTIONS_TOKEN_REQUIRED');
  const listing = await githubJson('list',token,fetcher);
  if (!listing || !Number.isSafeInteger(listing.total_count) || listing.total_count < 0 ||
      !Array.isArray(listing.workflow_runs) || listing.workflow_runs.length > 100) reject('GITHUB_RUN_LIST_INVALID');
  const runs = selectScheduledRuns(listing.workflow_runs,now);
  const jobs = new Map();
  for (const run of runs) {
    const listing = await githubJson(run.id,token,fetcher);
    if (!listing || listing.total_count !== 1 || !Array.isArray(listing.jobs) || listing.jobs.length !== 1) {
      reject('TICK_JOB_NOT_VERIFIED');
    }
    jobs.set(run.id,listing.jobs);
  }
  return assessScheduledRunEvidence(runs,jobs,now);
}

export async function main(env=process.env,fetcher=fetch,now=new Date()) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== 'erwinmehehe/payrollph' ||
      env.GITHUB_REF !== 'refs/heads/main' || !['schedule','workflow_dispatch','push'].includes(env.GITHUB_EVENT_NAME)) reject('TRUSTED_OBSERVER_CONTEXT_REQUIRED');
  const report=await collectScheduledRunEvidence({token:env.GITHUB_TOKEN,fetcher,now});
  mkdirSync('qa-artifacts',{recursive:true});
  writeFileSync(OUTPUT,JSON.stringify(report,null,2)+'\n',{flag:'w',mode:0o600});
  const summary = [
    '## Scheduler scheduled-run observation (read-only)',
    '',
    'Status: ' + report.state,
    'Authenticated GitHub scheduled events verified: ' + report.scheduledEventCount + '/3',
    '',
    'No database, Vercel app endpoint, payroll worker, or payment provider was contacted.',
    'A successful OBSERVER job is not evidence of live scheduler health or release approval.',
    'Activation remains OFF. Separate deployed heartbeat and independent alerts are required.',
    '',
  ].join('\n');
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY,summary);
  process.stdout.write(summary);
  if (!report.threeDistinctScheduledEventsProven) process.stdout.write('NOT PROVEN: three distinct real scheduled GitHub runs have not been observed.\n');
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e=>{
    console.error('Scheduler observer failed closed: ' + (e instanceof ObserverError ? e.code : 'UNEXPECTED_ERROR'));
    process.exitCode=1;
  });
}
