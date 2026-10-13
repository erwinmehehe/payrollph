import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  classifyReviewScope, allowedHumanReviewerLogins, evaluateIndependentReview,
} from "../scripts/lib/independent-pr-review-policy.mjs";
import { checkIndependentReview } from "../scripts/check-independent-pr-review.mjs";

const sha = "a".repeat(40);
const prior = "b".repeat(40);
const moneyFile = { filename: "src/lib/payroll-engine.ts", status: "modified" };
const pr = (files, extra = {}) => ({
  state: "open", number: 100,
  user: { login: "author" },
  base: { ref: "main" }, head: { sha },
  changed_files: files.length, draft: false, ...extra,
});
const human = (name = "reviewer", extra = {}) => ({
  id: 234, state: "APPROVED",
  submitted_at: "2026-10-12T00:00:00Z", commit_id: sha,
  user: { login: name, type: "User" }, ...extra,
});
const review = (files, extras = {}) => evaluateIndependentReview({
  pr: pr(files), files, expectedHeadSha: sha,
  reviews: [human()], reviewerAllowlist: "reviewer",
  permissions: { reviewer: "write" }, ...extras,
});

test("payroll, approval, payouts, bank, migrations, protected policies require a named human", () => {
  for (const path of [
    "src/lib/payroll-engine.ts",
    "src/lib/final-pay.ts",
    "src/app/api/payroll-runs/[id]/release/route.ts",
    "src/app/api/approvals/route.ts",
    "src/db/schema.ts",
    "src/components/workspace/payroll.tsx",
    "drizzle/0115_provider_events.sql",
    ".github/workflows/pr-integration-queue-gate.yml",
    ".github/CODEOWNERS",
    "scripts/worker.ts",
    "scripts/lib/scheduler-watchdog.mjs",
    "docs/engineering/change-risk-policy.md",
  ]) {
    const files = [{ filename: path, status: "modified" }];
    assert.equal(classifyReviewScope(files).requiresIndependentHuman, true, path);
    assert.equal(review(files).ok, true, path);
  }
  const docs = [{ filename: "docs/marketing/about-us.md", status: "modified" }];
  assert.equal(classifyReviewScope(docs).requiresIndependentHuman, false);
  assert.equal(review(docs, { reviews: [], reviewerAllowlist: "", permissions: {} }).ok, true);
});

test("renamed-away or deleted high-risk files cannot launder scope", () => {
  const renamed = [{
    filename: "docs/marketing/deprecated.txt",
    previous_filename: "src/lib/payroll-engine.ts", status: "renamed",
  }];
  assert.equal(classifyReviewScope(renamed).requiresIndependentHuman, true);
  assert.equal(review(renamed).ok, true);
  assert.throws(() => classifyReviewScope([{
    filename: "docs/test.txt", previous_filename: "../secrets.ts", status: "renamed",
  }]), /REVIEW_GATE_INVALID_CHANGED_PATH/);
  assert.throws(() => classifyReviewScope(Array(3000).fill(moneyFile)),
    /REVIEW_GATE_FILES_MISSING_OR_TRUNCATED/);
  assert.throws(() => review([moneyFile], { pr: pr([], { changed_files: 0 }) }),
    /REVIEW_GATE_PR_HEAD_OR_FILE_SET_UNVERIFIED/);
});

test("blank, invalid, duplicate and bot reviewer registries cannot approve money-path PRs", () => {
  assert.deepEqual(allowedHumanReviewerLogins("  Alice, BOB "), ["alice", "bob"]);
  assert.deepEqual(allowedHumanReviewerLogins(""), []);
  for (const input of ["alice,ALICE", "alice,", "sample[bot]", "some-bot", "a\nbob"]) {
    assert.throws(() => allowedHumanReviewerLogins(input), /REVIEW_GATE_/);
  }
  assert.deepEqual(review([moneyFile], { reviewerAllowlist: "", reviews: [], permissions: {} }).blockers,
    ["NAMED_REVIEWER_NOT_CONFIGURED", "CURRENT_HEAD_INDEPENDENT_APPROVAL_REQUIRED"]);
  assert.equal(review([moneyFile], {
    reviewerAllowlist: "unlisted", permissions: { unlisted: "write" },
  }).ok, false, "approval from someone not named by repo operator does not count");
});

test("the PR author, GitHub bot and unauthorized account cannot self-approve", () => {
  const files = [moneyFile];
  for (const cases of [
    { reviewerAllowlist: "author", reviews: [human("author")], permissions: { author: "admin" } },
    { reviews: [human("reviewer", { user: { login: "reviewer", type: "Bot" } })] },
    { permissions: { reviewer: "read" } },
    { permissions: { reviewer: "" } },
    { reviews: [human("reviewer", { commit_id: prior })] },
    { reviews: [human("reviewer", { state: "COMMENTED" })] },
  ]) {
    assert.equal(review(files, cases).ok, false, JSON.stringify(cases));
  }
});

test("approval must be for exact most recent commit and survive current review state", () => {
  const files = [moneyFile];
  assert.equal(review(files, {
    reviews: [human("reviewer", { id: 200, commit_id: prior }), human("reviewer", { id: 240 })],
  }).ok, true);
  assert.equal(review(files, {
    reviews: [human("reviewer", { id: 200 }), human("reviewer", { id: 240, state: "DISMISSED" })],
  }).ok, false);
  assert.equal(review(files, {
    reviews: [human("reviewer", { id: 200 }), human("reviewer", { id: 240, state: "CHANGES_REQUESTED" })],
  }).ok, false);
  assert.equal(review(files, {
    reviews: [human("reviewer", { id: 200 }), human("reviewer", { id: 240, state: "COMMENTED" })],
  }).ok, true, "comments do not erase earlier valid approvals");
  assert.throws(() => review(files, { expectedHeadSha: prior }),
    /REVIEW_GATE_PR_HEAD_OR_FILE_SET_UNVERIFIED/);
});

test("a current approval is not release authority, and draft sensitive PRs stay blocked", () => {
  const pass = review([moneyFile]);
  assert.equal(pass.ok, true);
  assert.equal(pass.releaseAuthorized, false);
  assert.equal(pass.approvalCount, 1);
  const draft = review([moneyFile], { pr: pr([moneyFile], { draft: true }) });
  assert.ok(draft.blockers.includes("SENSITIVE_PR_STILL_DRAFT"));
  assert.equal(draft.ok, false);
});

test("only the exact two already-modified WFM-12 evidence files bypass pilot-start source freeze", async () => {
  const evidence = [
    { filename: "scripts/wfm-pilot-synthetic-evidence.mjs", status: "modified" },
    { filename: "tests/wfm-roster-scale-postgres.test.ts", status: "modified" },
  ];
  const scope = classifyReviewScope(evidence);
  assert.equal(scope.hcmWfmFrozen, true);
  assert.equal(scope.wfm12DevEvidence, true);
  assert.equal(review(evidence).ok, true, "strict-mode pilot freeze exception is test-only");
  assert.equal(review(evidence).releaseAuthorized, false);

  const fromSolo = await checkIndependentReview({
    ...env, INDEPENDENT_SOURCE_REVIEW_REQUIRED: "false",
    PAYROLL_INDEPENDENT_REVIEWERS: "", PILOT_HCM_WFM_STARTED: "false",
    PILOT_START_EVIDENCE_REF: "",
  }, fakeGithub({ files: evidence, reviews: [] }).fetcher);
  assert.equal(fromSolo.ok, true, "repo's approved solo-maintainer policy can accept development evidence");
  assert.equal(fromSolo.mode, "solo-maintainer");
  assert.equal(fromSolo.approvalCount, 0);
  assert.equal(fromSolo.releaseAuthorized, false);

  const variants = [
    [evidence[0]],
    [evidence[1]],
    [...evidence, { filename: "src/lib/workforce-roster-scale.ts", status: "modified" }],
    [...evidence, { filename: "drizzle/0118_wfm_roster_scale_rules.sql", status: "modified" }],
    [...evidence, { filename: "tests/wfm-new-runtime.test.ts", status: "added" }],
    evidence.map((file, i) => i === 1 ? { ...file, status: "added" } : file),
    evidence.map((file, i) => i === 1 ? { ...file, status: "removed" } : file),
    evidence.map((file, i) => i === 1 ? { ...file, status: "renamed", previous_filename: "tests/wfm-old.test.ts" } : file),
    [evidence[0], evidence[0]],
  ];
  for (const changed of variants) {
    assert.equal(classifyReviewScope(changed).wfm12DevEvidence, false);
    const strict = review(changed);
    assert.equal(strict.ok, false);
    assert.ok(strict.blockers.includes("PILOT_HCM_WFM_FREEZE_ACTIVE"));
    const solo = await checkIndependentReview({
      ...env, INDEPENDENT_SOURCE_REVIEW_REQUIRED: "false",
      PAYROLL_INDEPENDENT_REVIEWERS: "", PILOT_HCM_WFM_STARTED: "false",
      PILOT_START_EVIDENCE_REF: "",
    }, fakeGithub({ files: changed, reviews: [] }).fetcher);
    assert.equal(solo.ok, false);
    assert.deepEqual(solo.blockers, ["PILOT_HCM_WFM_FREEZE_ACTIVE"]);
  }
});

test("HCM/WFM/compensation remain frozen even when independently approved", () => {
  for (const path of [
    "src/lib/hcm-compensation.ts",
    "src/lib/workforce-roster.ts",
    "src/app/api/hcm/work-items/route.ts",
    "src/app/api/workforce/coverage/route.ts",
    "src/components/workspace/compensation.tsx",
    "tests/wfm-coverage.test.ts",
    "drizzle/0115_hcm_worker360.sql",
  ]) {
    const files = [{ filename: path, status: "modified" }];
    const blocked = review(files);
    assert.equal(blocked.scope.hcmWfmFrozen, true, path);
    assert.ok(blocked.blockers.includes("PILOT_HCM_WFM_FREEZE_ACTIVE"), path);
    const enabled = review(files, {
      pilotStarted: "true", pilotEvidenceRef: "PILOT-START-REVIEW-2026-10",
    });
    assert.equal(enabled.ok, true, path);
    assert.equal(enabled.releaseAuthorized, false);
  }
  assert.equal(review([moneyFile], {
    pilotStarted: "false", pilotEvidenceRef: "",
  }).ok, true, "core payroll fixes are not part of optional HCM/WFM freeze");
});

const env = {
  INDEPENDENT_SOURCE_REVIEW_REQUIRED: "true",
  GITHUB_REPOSITORY: "erwinmehehe/payrollph",
  GITHUB_TOKEN: "synthetic-read-only-token-not-real",
  PR_NUMBER: "100",
  PR_HEAD_SHA: sha,
  PAYROLL_INDEPENDENT_REVIEWERS: "reviewer",
  PILOT_HCM_WFM_STARTED: "false",
  PILOT_START_EVIDENCE_REF: "",
};
function fakeGithub({ files = [moneyFile], reviews = [human()], permission = "write",
  failure = null, mismatch = false } = {}) {
  const calls = [];
  return {
    calls,
    async fetcher(url, request) {
      calls.push({ url, request });
      if (request.method !== "GET") throw new Error("unexpected write");
      if (failure && url.includes(failure)) {
        return new Response('{"message":"not permitted"}', {
          status: 403, headers: { "content-type": "application/json" },
        });
      }
      let body;
      if (url.endsWith("/pulls/100")) body = pr(files, mismatch ? { head: { sha: prior } } : {});
      else if (url.includes("/pulls/100/files?")) {
        const page = Number(new URL(url).searchParams.get("page"));
        body = files.slice((page - 1) * 100, page * 100);
      }
      else if (url.includes("/pulls/100/reviews?")) {
        const page = Number(new URL(url).searchParams.get("page"));
        body = reviews.slice((page - 1) * 100, page * 100);
      }
      else if (url.includes("/collaborators/reviewer/permission")) body = { permission };
      else throw new Error("unexpected GitHub URL");
      return new Response(JSON.stringify(body), {
        status: 200, headers: { "content-type": "application/json" },
      });
    },
  };
}

test("solo source mode validates the actual head without inventing independent approval", async () => {
  for (const value of [undefined, "", "false", "TRUE"]) {
    const api = fakeGithub();
    const verdict = await checkIndependentReview({ ...env,
      INDEPENDENT_SOURCE_REVIEW_REQUIRED: value,
      PAYROLL_INDEPENDENT_REVIEWERS: "" }, api.fetcher);
    assert.equal(verdict.ok, true);
    assert.equal(verdict.mode, "solo-maintainer");
    assert.equal(verdict.approvalCount, 0);
    assert.equal(verdict.releaseAuthorized, false);
    assert.equal(api.calls.length, 2, "no review or collaborator impersonation");
  }
  const stale = fakeGithub({ mismatch: true });
  await assert.rejects(checkIndependentReview({ ...env,
    INDEPENDENT_SOURCE_REVIEW_REQUIRED: "false" }, stale.fetcher),
    /REVIEW_GATE_PR_HEAD_OR_FILE_SET_UNVERIFIED/);
  const strict = fakeGithub({ reviews: [] });
  const verdict = await checkIndependentReview(env, strict.fetcher);
  assert.equal(verdict.ok, false, "explicit strict mode retains current-head review");
});

test("solo-maintainer source policy keeps the HCM/WFM pilot freeze intact", async () => {
  const frozen = { filename: "src/lib/wfm-roster.ts", status: "modified" };
  const api = fakeGithub({ files: [frozen], reviews: [] });
  const blocked = await checkIndependentReview({
    ...env, INDEPENDENT_SOURCE_REVIEW_REQUIRED: "false",
    PAYROLL_INDEPENDENT_REVIEWERS: "", PILOT_HCM_WFM_STARTED: "false",
    PILOT_START_EVIDENCE_REF: "",
  }, api.fetcher);
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.blockers, ["PILOT_HCM_WFM_FREEZE_ACTIVE"]);
  assert.equal(blocked.approvalCount, 0);
  assert.equal(blocked.releaseAuthorized, false);
  assert.equal(api.calls.length, 2);

  const allowed = await checkIndependentReview({
    ...env, INDEPENDENT_SOURCE_REVIEW_REQUIRED: "false",
    PAYROLL_INDEPENDENT_REVIEWERS: "", PILOT_HCM_WFM_STARTED: "true",
    PILOT_START_EVIDENCE_REF: "PILOT-START-REVIEW-2026-10",
  }, fakeGithub({ files: [frozen], reviews: [] }).fetcher);
  assert.equal(allowed.ok, true);
  assert.equal(allowed.releaseAuthorized, false);

  const unverified = await checkIndependentReview({
    ...env, INDEPENDENT_SOURCE_REVIEW_REQUIRED: "false",
    PAYROLL_INDEPENDENT_REVIEWERS: "", PILOT_HCM_WFM_STARTED: "true",
    PILOT_START_EVIDENCE_REF: "bad",
  }, fakeGithub({ files: [frozen], reviews: [] }).fetcher);
  assert.equal(unverified.ok, false);
});

test("live gate uses GitHub API GET only, with read-only token and current-head review", async () => {
  const mock = fakeGithub();
  const verdict = await checkIndependentReview(env, mock.fetcher);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.releaseAuthorized, false);
  assert.ok(mock.calls.every(x => x.request.method === "GET"));
  assert.ok(mock.calls.every(x => x.request.redirect === "error"));
  assert.ok(mock.calls.every(x => x.url.startsWith("https://api.github.com/repos/erwinmehehe/payrollph/")));
  assert.ok(mock.calls.every(x => x.request.headers.Authorization.includes("synthetic-read-only")));
});

test("stale API PR head, unreadable permissions and insufficient scope fail closed", async () => {
  await assert.rejects(() => checkIndependentReview(env, fakeGithub({ mismatch: true }).fetcher),
    /REVIEW_GATE_PR_HEAD_OR_FILE_SET_UNVERIFIED/);
  await assert.rejects(() => checkIndependentReview(env, fakeGithub({
    failure: "/collaborators/reviewer/permission",
  }).fetcher), /REVIEW_GATE_GITHUB_UNAVAILABLE_OR_ACCESS_DENIED/);
  const missing = fakeGithub({ permission: "read" });
  assert.equal((await checkIndependentReview(env, missing.fetcher)).ok, false);
  await assert.rejects(() => checkIndependentReview({
    ...env, GITHUB_REPOSITORY: "evil/../repo",
  }, fakeGithub().fetcher), /REVIEW_GATE_INVALID_REPOSITORY/);
});

test("workflow never executes untrusted PR head, never writes approval, and is protected-branch only", () => {
  const source = readFileSync(".github/workflows/independent-payroll-review-gate.yml", "utf8");
  assert.match(source, /pull_request_target:/);
  assert.match(source, /pull_request_review:/);
  assert.match(source, /pull-requests: read/);
  assert.match(source, /persist-credentials: false/);
  assert.match(source, /repository\.default_branch/);
  assert.doesNotMatch(source, /pull_request\.head\.sha.*\n\s*fetch-depth/);
  assert.doesNotMatch(source, /pull-requests: write/);
  assert.match(source, /PAYROLL_INDEPENDENT_REVIEWERS:/);
});

test("a sensitive change at file 101 cannot hide behind GitHub's first page", async () => {
  const docs = Array.from({ length: 100 }, (_, index) => ({
    filename: "docs/marketing/topic-" + index + ".md", status: "modified",
  }));
  const mock = fakeGithub({ files: [...docs, moneyFile] });
  const gate = await checkIndependentReview(env, mock.fetcher);
  assert.equal(gate.ok, true);
  assert.equal(gate.scope.sensitiveFileCount, 1);
  assert.ok(mock.calls.some(call => call.url.includes("files?per_page=100&page=2")),
    "must inspect the second GitHub files page");
});

test("frozen WFM change on a later files page blocks even a valid approval", async () => {
  const docs = Array.from({ length: 100 }, (_, index) => ({
    filename: "docs/marketing/topic-" + index + ".md", status: "modified",
  }));
  const mock = fakeGithub({ files: [
    ...docs, { filename: "src/app/api/workforce/coverage/route.ts", status: "modified" },
  ] });
  const gate = await checkIndependentReview(env, mock.fetcher);
  assert.equal(gate.ok, false);
  assert.ok(gate.blockers.includes("PILOT_HCM_WFM_FREEZE_ACTIVE"));
});
