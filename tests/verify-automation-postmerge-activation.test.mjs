import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePostmergeActivation } from "../scripts/verify-automation-postmerge-activation.mjs";
import { REQUIRED_WORKFLOWS } from "../scripts/verify-automation-language-release.mjs";

const sha = "a".repeat(40);
const obsolete = "b".repeat(40);
const reviewed = (prefix, lines, who = "reviewer", association = "COLLABORATOR") => ({
  user: { login: who, type: "User" },
  author_association: association,
  body: [prefix + ": " + sha, ...lines].join("\n"),
});
const security = ["INTENT-FIDELITY: PASS", "TENANT-ACCESS: VERIFIED",
  "NO-EXECUTION-BYPASS: VERIFIED"];
const staging = ["LIVE-PROVIDER: PASS", "NONPROD-DB: VERIFIED",
  "MFA: VERIFIED", "NO-PRODUCTION-DATA: VERIFIED", "ROLLOUT-FLAG: OFF"];

function fixture() {
  return {
    expectedSha: sha,
    pr: { number: 609, state: "closed", merged: true,
      merged_at: "2026-10-09T13:07:27Z", merge_commit_sha: sha,
      user: { login: "erwinmehehe" }, base: { ref: "main" },
      head: { ref: "feature/automation-studio-language-drafts",
        repo: { full_name: "erwinmehehe/payrollph" } } },
    mainRef: { ref: "refs/heads/main", object: { sha } },
    ancestry: { status: "identical", behind_by: 0, ahead_by: 0 },
    reviewIssue: { state: "closed" },
    stagingIssue: { state: "closed" },
    securityComments: [reviewed("SECURITY-REVIEWED", security)],
    stagingComments: [reviewed("STAGING-ACCEPTED", staging, "staging-reviewer")],
    runs: REQUIRED_WORKFLOWS.map((name, i) => ({
      name, head_sha: sha, event: name.includes("Synthetic") ? "workflow_dispatch" : "push",
      status: "completed", conclusion: "success", run_attempt: 1,
      created_at: "2026-10-09T14:00:00Z", id: i + 10,
    })),
  };
}

test("complete independent post-merge evidence may be reviewed for activation", () => {
  const result = evaluatePostmergeActivation(fixture());
  assert.equal(result.readyForActivationDecision, true, JSON.stringify(result.reasons));
  assert.equal(result.checkedSha, sha);
});

test("unmerged or incorrect PR, branch, commit or ancestry fails closed", () => {
  const cases = [
    (x) => { x.pr.merged = false; },
    (x) => { x.pr.state = "open"; },
    (x) => { x.pr.merge_commit_sha = obsolete; },
    (x) => { x.pr.number = 610; },
    (x) => { x.pr.head.repo.full_name = "other/fork"; },
    (x) => { x.pr.base.ref = "feature"; },
    (x) => { x.mainRef.object.sha = obsolete; },
    (x) => { x.mainRef.ref = "refs/heads/other"; },
    (x) => { x.ancestry = null; },
    (x) => { x.ancestry.behind_by = 1; },
    (x) => { x.ancestry.status = "diverged"; },
    (x) => { x.ancestry.status = "identical"; x.ancestry.ahead_by = 0;
      x.pr.merge_commit_sha = obsolete; },
    (x) => { x.expectedSha = obsolete; },
    (x) => { x.expectedSha = "not-sha"; },
  ];
  for (const edit of cases) {
    const x = fixture(); edit(x);
    assert.equal(evaluatePostmergeActivation(x).readyForActivationDecision,
      false, JSON.stringify(x.pr));
  }
});

test("trusted human non-author exact-main signoff is mandatory", () => {
  const cases = [
    (x) => { x.reviewIssue.state = "open"; },
    (x) => { x.stagingIssue.state = "open"; },
    (x) => { x.securityComments = []; },
    (x) => { x.stagingComments = []; },
    (x) => { x.securityComments[0].user.login = "erwinmehehe"; },
    (x) => { x.securityComments[0].user.login = "ERWINMEHEHE"; },
    (x) => { x.stagingComments[0].user.login = "erwinmehehe"; },
    (x) => { x.securityComments[0].user.type = "Bot"; },
    (x) => { x.stagingComments[0].user.type = undefined; },
    (x) => { x.securityComments[0].author_association = "NONE"; },
    (x) => { x.stagingComments[0].author_association = "CONTRIBUTOR"; },
    (x) => { x.securityComments[0].body = "SECURITY-REVIEWED: " + obsolete; },
    (x) => { x.stagingComments[0].body = "STAGING-ACCEPTED: " + obsolete; },
    (x) => { x.securityComments[0].body = "SECURITY-REVIEWED: " + sha; },
    (x) => { x.stagingComments[0].body = "STAGING-ACCEPTED: " + sha; },
    (x) => { x.stagingComments[0].body = x.stagingComments[0].body.replace("ROLLOUT-FLAG: OFF", "ROLLOUT-FLAG: ON"); },
  ];
  for (const edit of cases) {
    const x = fixture(); edit(x);
    assert.equal(evaluatePostmergeActivation(x).readyForActivationDecision,
      false, JSON.stringify(x.securityComments));
  }
});

test("all six fresh exact-main workflows must pass including manually dispatched synthetic acceptance", () => {
  for (const edit of [
    (x) => { x.runs.pop(); },
    (x) => { x.runs[0].head_sha = obsolete; },
    (x) => { x.runs[0].status = "in_progress"; },
    (x) => { x.runs[0].conclusion = "failure"; },
    (x) => { x.runs[0].event = "schedule"; },
    (x) => { const y = { ...x.runs[0], id: 999,
      created_at: "2026-10-09T15:00:00Z", conclusion: "failure" }; x.runs.push(y); },
  ]) {
    const x = fixture(); edit(x);
    assert.equal(evaluatePostmergeActivation(x).readyForActivationDecision, false);
  }
});

test("new main commits are permitted only when independently re-attested and fully retested", () => {
  const x = fixture();
  x.pr.merge_commit_sha = obsolete;
  x.ancestry = { status: "ahead", behind_by: 0, ahead_by: 1 };
  assert.equal(evaluatePostmergeActivation(x).readyForActivationDecision, true);
  x.mainRef.object.sha = obsolete;
  assert.equal(evaluatePostmergeActivation(x).readyForActivationDecision, false);
});
