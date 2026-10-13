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

test("core Time retention safety repair can be independently reviewed before pilot, never self-approved", () => {
  const paths = [
    "src/lib/workforce-punch-evidence.ts",
    "src/lib/workforce-punch-retention.ts",
    "tests/workforce-punch-evidence.test.ts",
    "tests/workforce-punch-retention-db.test.ts",
  ];
  const files = paths.map(filename => ({ filename, status: "modified" }));
  const scope = classifyReviewScope(files);
  assert.equal(scope.hcmWfmFrozen, true);
  assert.equal(scope.coreTimeRetentionSafetyRepair, true);
  assert.equal(scope.requiresIndependentHuman, true);
  const accepted = review(files);
  assert.equal(accepted.ok, true, "a named non-author human can review the bounded safety fix pre-pilot");
  assert.equal(accepted.releaseAuthorized, false);
  const missing = review(files, {
    reviewerAllowlist: "", reviews: [], permissions: {},
  });
  assert.equal(missing.ok, false);
  assert.ok(missing.blockers.includes("NAMED_REVIEWER_NOT_CONFIGURED"));
  assert.ok(missing.blockers.includes("CURRENT_HEAD_INDEPENDENT_APPROVAL_REQUIRED"));
  assert.equal(review(files, { reviews: [human("reviewer", { commit_id: prior })] }).ok, false,
    "stale-head approval must never qualify for a retention safety repair");
  assert.equal(review(files, { permissions: { reviewer: "read" } }).ok, false);
  assert.equal(review(files, { pr: pr(files, { draft: true }) }).ok, false);
});

test("core Time retention exemption refuses unrelated WFM, added, deleted and renamed changes", () => {
  const base = [
    "src/lib/workforce-punch-evidence.ts",
    "src/lib/workforce-punch-retention.ts",
    "tests/workforce-punch-evidence.test.ts",
    "tests/workforce-punch-retention-db.test.ts",
  ].map(filename => ({ filename, status: "modified" }));
  const variants = [
    base.slice(0, 3),
    [...base, { filename: "src/lib/workforce-roster-rules.ts", status: "modified" }],
    [...base, { filename: "drizzle/0122_new_wfm_feature.sql", status: "added" }],
    base.map((file, i) => i === 0 ? { ...file, status: "added" } : file),
    base.map((file, i) => i === 1 ? { ...file, status: "removed" } : file),
    base.map((file, i) => i === 1 ? {
      ...file, status: "renamed", previous_filename: "src/lib/workforce-roster.ts",
    } : file),
    [base[0], base[1], base[1], base[3]],
  ];
  for (const files of variants) {
    const result = review(files);
    assert.equal(result.scope.coreTimeRetentionSafetyRepair, false);
    assert.equal(result.scope.hcmWfmFrozen, true);
    assert.ok(result.blockers.includes("PILOT_HCM_WFM_FREEZE_ACTIVE"));
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
