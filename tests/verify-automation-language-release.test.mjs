import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateGate, REQUIRED_WORKFLOWS } from '../scripts/verify-automation-language-release.mjs';

const sha = 'a'.repeat(40);
const oldSha = 'b'.repeat(40);
const fixture = () => ({
  expectedSha: sha,
  pr: { head: { sha, ref: 'feature/automation-studio-language-drafts', repo: { full_name: 'erwinmehehe/payrollph' } },
    base: { ref: 'main' }, user: { login: 'author' }, state: 'open', draft: false, merged_at: null },
  reviews: [{ id: 1, user: { login: 'reviewer' }, author_association: 'COLLABORATOR', state: 'APPROVED',
    commit_id: sha, submitted_at: '2026-10-08T11:00:00Z' }],
  issueReview: { state: 'closed' },
  issueStaging: { state: 'closed' },
  comments: [{ user: { login: 'reviewer' }, author_association: 'COLLABORATOR',
    body: `STAGING-ACCEPTED: ${sha}\nLIVE-PROVIDER: PASS\nNONPROD-DB: VERIFIED\nMFA: VERIFIED\nNO-PRODUCTION-DATA: VERIFIED` }],
  runs: REQUIRED_WORKFLOWS.map((name, i) => ({ name, head_sha: sha, status: 'completed', conclusion: 'success',
    run_attempt: 1, created_at: '2026-10-08T10:00:00Z', id: 100 + i })),
});

test('exact-SHA independent approval and six successful checks permit human review decision', () => {
  assert.equal(evaluateGate(fixture()).readyForHumanMergeDecision, true);
});

test('fail closed on changed head, branch, base, PR status or repository', () => {
  const edits = [
    (x) => { x.expectedSha = oldSha; },
    (x) => { x.pr.head.sha = oldSha; },
    (x) => { x.pr.head.ref = 'malicious-branch'; },
    (x) => { x.pr.head.repo.full_name = 'malicious/fork'; },
    (x) => { x.pr.base.ref = 'not-main'; },
    (x) => { x.pr.state = 'closed'; },
    (x) => { x.pr.draft = true; },
    (x) => { x.pr.merged_at = '2026-10-08T12:00:00Z'; },
  ];
  for (const edit of edits) { const x = fixture(); edit(x); assert.equal(evaluateGate(x).readyForHumanMergeDecision, false); }
});

test('rejects self-review, untrusted reviews and stale approvals', () => {
  const edits = [
    (x) => { x.reviews[0].user.login = 'author'; },
    (x) => { x.reviews[0].user.login = 'test[bot]'; },
    (x) => { x.reviews[0].author_association = 'NONE'; },
    (x) => { x.reviews[0].commit_id = oldSha; },
    (x) => { x.reviews[0].submitted_at = null; },
  ];
  for (const edit of edits) { const x = fixture(); edit(x); assert.equal(evaluateGate(x).readyForHumanMergeDecision, false); }
});

test('newer CHANGES_REQUESTED from approved reviewer blocks; newer approval clears', () => {
  const x = fixture();
  x.reviews.push({ ...x.reviews[0], id: 2, state: 'CHANGES_REQUESTED', submitted_at: '2026-10-08T12:00:00Z' });
  assert.equal(evaluateGate(x).readyForHumanMergeDecision, false);
  x.reviews.push({ ...x.reviews[0], id: 3, state: 'APPROVED', submitted_at: '2026-10-08T13:00:00Z' });
  assert.equal(evaluateGate(x).readyForHumanMergeDecision, true);
});

test('outstanding changes requested by another trusted reviewer block release', () => {
  const x = fixture();
  x.reviews.push({ ...x.reviews[0], id: 4, user: { login: 'second' }, state: 'CHANGES_REQUESTED' });
  assert.equal(evaluateGate(x).readyForHumanMergeDecision, false);
});

test('latest run on identical head must pass; stale success cannot mask newer failure', () => {
  for (const conclusion of ['failure', 'cancelled', null]) {
    const x = fixture();
    x.runs.push({ ...x.runs[0], id: 999, created_at: '2026-10-08T13:00:00Z', conclusion });
    assert.equal(evaluateGate(x).readyForHumanMergeDecision, false);
  }
  const absent = fixture(); absent.runs.pop();
  assert.equal(evaluateGate(absent).readyForHumanMergeDecision, false);
  const stale = fixture(); stale.runs[0].head_sha = oldSha;
  assert.equal(evaluateGate(stale).readyForHumanMergeDecision, false);
});

test('rejects unresolved tracking issues', () => {
  const a = fixture(); a.issueReview.state = 'open';
  assert.equal(evaluateGate(a).readyForHumanMergeDecision, false);
  const b = fixture(); b.issueStaging.state = 'open';
  assert.equal(evaluateGate(b).readyForHumanMergeDecision, false);
});

test('staging attestation must be independently authored and include exact evidence lines', () => {
  const changes = [
    (x) => { x.comments = []; },
    (x) => { x.comments[0].user.login = 'author'; },
    (x) => { x.comments[0].user.login = 'bot[bot]'; },
    (x) => { x.comments[0].author_association = 'NONE'; },
    (x) => { x.comments[0].body = `STAGING-ACCEPTED: ${oldSha}`; },
    (x) => { x.comments[0].body = `STAGING-ACCEPTED: ${sha}`; },
    (x) => { x.comments[0].body = `quoted STAGING-ACCEPTED: ${sha}\nLIVE-PROVIDER: PASS\nNONPROD-DB: VERIFIED\nMFA: VERIFIED\nNO-PRODUCTION-DATA: VERIFIED`; },
  ];
  for (const edit of changes) { const x = fixture(); edit(x); assert.equal(evaluateGate(x).readyForHumanMergeDecision, false); }
});
