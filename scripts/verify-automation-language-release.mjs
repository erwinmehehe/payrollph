#!/usr/bin/env node
/**
 * Read-only pre-merge verification for PayrollPH Automation Studio PR #609.
 * NEVER approves, merges, deploys, enables workflows, or certifies production.
 * A green report is a review aid, not permission to release.
 */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const REQUIRED_WORKFLOWS = Object.freeze([
  'CI',
  'Automation Language Acceptance (Synthetic)',
  'Security HTTP Smoke',
  'CodeQL Security',
  'Payout Payroll Isolation',
  'Isolated Backup and Restore Rehearsal',
]);

const EVIDENCE_LINES = Object.freeze([
  'LIVE-PROVIDER: PASS',
  'NONPROD-DB: VERIFIED',
  'MFA: VERIFIED',
  'NO-PRODUCTION-DATA: VERIFIED',
]);
const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const SHA = /^[a-f0-9]{40}$/;
const human = (login) => typeof login === 'string' && login.length > 0 && !login.endsWith('[bot]');
const trustworthy = (record, author) => human(record?.user?.login)
  && record.user.login !== author && TRUSTED_ASSOCIATIONS.has(record.author_association);

/** Pure logic, exercised by tests with synthetic GitHub data. */
export function evaluateGate({ pr, baseComparison, reviews, issueReview, issueStaging, comments, runs, expectedSha }) {
  const reasons = [];
  const sha = pr?.head?.sha;
  const author = pr?.user?.login;

  if (!SHA.test(sha ?? '')) reasons.push('Pull request head SHA not verified');
  if (!SHA.test(expectedSha ?? '') || sha !== expectedSha) reasons.push('PR head differs from exact pinned review SHA');
  if (pr?.state !== 'open' || pr?.merged_at) reasons.push('PR must remain open and unmerged');
  if (pr?.draft) reasons.push('PR is still a draft');
  if (pr?.base?.ref !== 'main') reasons.push('Unexpected PR base branch');
  if (pr?.head?.ref !== 'feature/automation-studio-language-drafts') reasons.push('Unexpected PR head branch');
  if (pr?.head?.repo?.full_name && pr.head.repo.full_name !== 'erwinmehehe/payrollph') {
    reasons.push('Unexpected PR head repository');
  }
  // A green build on an older branch does not prove it merges with the
  // current main branch. Fail closed on conflicts, unknown ancestry or lag.
  if (pr?.mergeable !== true) {
    reasons.push('GitHub does not confirm the current PR can merge cleanly');
  }
  if (!baseComparison
    || baseComparison.behind_by !== 0
    || !['ahead', 'identical'].includes(baseComparison.status)
    || !Number.isSafeInteger(baseComparison.ahead_by)) {
    reasons.push('PR head is behind main or current main ancestry could not be verified');
  }

  const latestRuns = new Map();
  for (const run of Array.isArray(runs) ? runs : []) {
    if (run.head_sha !== sha || !REQUIRED_WORKFLOWS.includes(run.name)) continue;
    const order = `${run.created_at ?? ''}/${String(run.run_attempt ?? 0).padStart(6, '0')}/${String(run.id ?? 0).padStart(20, '0')}`;
    const previous = latestRuns.get(run.name);
    if (!previous || order > previous.order) latestRuns.set(run.name, { run, order });
  }
  for (const name of REQUIRED_WORKFLOWS) {
    const run = latestRuns.get(name)?.run;
    if (!run || run.status !== 'completed' || run.conclusion !== 'success') {
      reasons.push(`Required workflow is not successful on this PR head: ${name}`);
    }
  }

  // GitHub lets people without write permissions submit non-binding PR reviews.
  // Require an independent trusted collaborator and their *latest* exact-SHA approval.
  const latestReviews = new Map();
  for (const review of Array.isArray(reviews) ? reviews : []) {
    if (!trustworthy(review, author) || !review.submitted_at) continue;
    const user = review.user.login;
    const order = `${review.submitted_at}/${String(review.id ?? 0).padStart(20, '0')}`;
    const prev = latestReviews.get(user);
    if (!prev || order > prev.order) latestReviews.set(user, { review, order });
  }
  const finalReviews = [...latestReviews.values()].map(({ review }) => review);
  if (!finalReviews.some((r) => r.state === 'APPROVED' && r.commit_id === sha)) {
    reasons.push('No independent authorized human approval on exact PR head');
  }
  if (finalReviews.some((r) => r.state === 'CHANGES_REQUESTED')) {
    reasons.push('At least one independent review still requests changes');
  }

  if (issueReview?.state !== 'closed') reasons.push('Independent review issue #621 remains open');
  if (issueStaging?.state !== 'closed') reasons.push('Live-provider staging issue #622 remains open');

  const attested = (Array.isArray(comments) ? comments : []).some((comment) => {
    if (!trustworthy(comment, author)) return false;
    const lines = (typeof comment.body === 'string' ? comment.body : '')
      .split(/\r?\n/).map((line) => line.trim());
    return lines.includes(`STAGING-ACCEPTED: ${sha}`)
      && EVIDENCE_LINES.every((line) => lines.includes(line));
  });
  if (!attested) reasons.push('No independent exact-SHA staging acceptance attestation');

  return {
    readyForHumanMergeDecision: reasons.length === 0,
    checkedSha: SHA.test(sha ?? '') ? sha : null,
    reasons,
    note: 'Read-only evidence summary; never a deployment or certification approval.',
  };
}

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}`);
  return { data: await response.json(), next: response.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1] };
}

async function getPages(root, path, token, arrayField = null) {
  let next = root + path;
  const all = [];
  for (let page = 0; page < 10 && next; page++) {
    const u = new URL(next);
    if (u.origin !== 'https://api.github.com' || !u.pathname.startsWith('/repos/erwinmehehe/payrollph/')) {
      throw new Error('Unexpected pagination URL');
    }
    const { data, next: following } = await fetchJson(next, token);
    const rows = arrayField === null ? data : data[arrayField];
    if (!Array.isArray(rows)) throw new Error('GitHub returned unexpected collection format');
    all.push(...rows);
    next = following ?? null;
  }
  if (next) throw new Error('GitHub collection exceeded pagination limit; refuse incomplete evidence');
  return all;
}

export async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const sha = process.env.AUTOMATION_REVIEWED_HEAD_SHA;
  if (repo !== 'erwinmehehe/payrollph') throw new Error('Repository guard mismatch');
  if (!token) throw new Error('Read-only GITHUB_TOKEN is required');
  if (!SHA.test(sha ?? '')) throw new Error('Pin the reviewed commit as AUTOMATION_REVIEWED_HEAD_SHA');

  const root = `https://api.github.com/repos/${repo}`;
  const get = async (path) => (await fetchJson(root + path, token)).data;
  const [pr, baseComparison, reviews, issueReview, issueStaging, comments, runs] = await Promise.all([
    get('/pulls/609'),
    get(`/compare/main...${sha}`),
    getPages(root, '/pulls/609/reviews?per_page=100', token),
    get('/issues/621'),
    get('/issues/622'),
    getPages(root, '/issues/622/comments?per_page=100', token),
    getPages(root, `/actions/runs?branch=feature%2Fautomation-studio-language-drafts&per_page=100`, token, 'workflow_runs'),
  ]);
  const result = evaluateGate({ pr, baseComparison, reviews, issueReview, issueStaging, comments, runs, expectedSha: sha });
  console.log(JSON.stringify({ gate: 'PayrollPH Automation Studio PR #609', ...result }, null, 2));
  if (!result.readyForHumanMergeDecision) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    // No token, response bodies, comments, or other sensitive API contents in errors.
    console.error(`Release gate could not be checked: ${error.message}`);
    process.exitCode = 1;
  });
}
