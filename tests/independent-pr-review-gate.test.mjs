import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  classifyReviewScope, allowedHumanReviewerLogins, evaluateIndependentReview,
  isApprovedVault902Source,
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
  failure = null, mismatch = false, number = 100, headSha = sha } = {}) {
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
      if (url.endsWith("/pulls/" + number)) body = pr(files, { number, head: { sha: mismatch ? prior : headSha } });
      else if (url.includes("/pulls/" + number + "/files?")) {
        const page = Number(new URL(url).searchParams.get("page"));
        body = files.slice((page - 1) * 100, page * 100);
      }
      else if (url.includes("/pulls/" + number + "/reviews?")) {
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

test("the exact 3 added WFM-5 development evidence blobs alone are eligible, with no release authority", async () => {
  const evidence = [
    {filename:".github/workflows/wfm-five-worker-dev-acceptance.yml",status:"added",
      sha:"f925a4d6e14ca02676b9a381a3f35dd5a52fd2eb"},
    {filename:"docs/wfm-five-worker-development-acceptance.md",status:"added",
      sha:"2bdb7bf9f9f92855f6ce04323af531f0d4a1f96a"},
    {filename:"scripts/qa/wfm-five-worker-dev-acceptance.ts",status:"added",
      sha:"fea3ed7ad0d2142a2828cdfdf0725aacc92c489c"},
  ];
  const scope = classifyReviewScope(evidence);
  assert.equal(scope.hcmWfmFrozen, true);
  assert.equal(scope.wfmFiveWorkerDevEvidence, true);
  assert.equal(review(evidence).ok, true);
  assert.equal(review(evidence).releaseAuthorized, false);

  const soloEnv = { ...env, INDEPENDENT_SOURCE_REVIEW_REQUIRED: "false",
    PAYROLL_INDEPENDENT_REVIEWERS: "", PILOT_HCM_WFM_STARTED: "false",
    PILOT_START_EVIDENCE_REF: "" };
  const solo = await checkIndependentReview(soloEnv,
    fakeGithub({ files: evidence, reviews: [] }).fetcher);
  assert.equal(solo.ok, true);
  assert.equal(solo.releaseAuthorized, false);
  assert.equal(solo.approvalCount, 0);

  const badSets = [
    evidence.slice(0,2),
    [evidence[0]],
    [...evidence, {filename:"src/app/api/workforce/schedules/route.ts",status:"modified",sha:"c".repeat(40)}],
    [...evidence, {filename:".github/workflows/payout.yml",status:"added",sha:"c".repeat(40)}],
    evidence.map((file,i) => i===0 ? {...file,sha:"c".repeat(40)} : file),
    evidence.map((file,i) => i===1 ? {...file,sha:null} : file),
    evidence.map((file,i) => i===2 ? {...file,status:"modified"} : file),
    evidence.map((file,i) => i===2 ? {...file,status:"removed"} : file),
    evidence.map((file,i) => i===1 ? {...file,status:"renamed",previous_filename:"docs/old.md"} : file),
    [evidence[0],evidence[0],evidence[2]],
  ];
  for (const files of badSets) {
    assert.equal(classifyReviewScope(files).wfmFiveWorkerDevEvidence,false);
    assert.equal(review(files).ok,false);
    assert.ok(review(files).blockers.includes("PILOT_HCM_WFM_FREEZE_ACTIVE"));
    const denied = await checkIndependentReview(soloEnv,
      fakeGithub({ files, reviews: [] }).fetcher);
    assert.equal(denied.ok,false);
    assert.deepEqual(denied.blockers,["PILOT_HCM_WFM_FREEZE_ACTIVE"]);
    assert.equal(denied.releaseAuthorized,false);
  }
});

test("only exact unchanged #965 HCM import regression blobs may pass source freeze", async () => {
  const files = [
    {filename: "tests/hcm-direct-route-policy-races.test.ts", status: "modified",
      sha: "c986dc63f7e490a4e8ec3360f56d2f0a49525539"},
    {filename: "tests/hcm-governed-intake.test.ts", status: "modified",
      sha: "94f9523c257a3b603ab726f61b5b80b11ff6e212"},
    {filename: "tests/hcm-legacy-write-integration.test.ts", status: "modified",
      sha: "ba929f96c369fc9db00e414ae360bf7ee2c4e4ea"},
  ];
  const scope = classifyReviewScope(files);
  assert.equal(scope.hcmWfmFrozen, true);
  assert.equal(scope.hcmIntakeRegressionDevEvidence, true);
  assert.equal(review(files).ok, true);
  assert.equal(review(files).releaseAuthorized, false);

  const soloEnv = {...env, INDEPENDENT_SOURCE_REVIEW_REQUIRED: "false",
    PAYROLL_INDEPENDENT_REVIEWERS: "", PILOT_HCM_WFM_STARTED: "false",
    PILOT_START_EVIDENCE_REF: ""};
  const allowed = await checkIndependentReview(soloEnv,
    fakeGithub({files, reviews: []}).fetcher);
  assert.equal(allowed.ok, true);
  assert.equal(allowed.mode, "solo-maintainer");
  assert.equal(allowed.approvalCount, 0);
  assert.equal(allowed.releaseAuthorized, false);

  const badSets = [
    files.slice(0, 2),
    [files[2]],
    [files[0], files[0], files[2]],
    files.map((x, i) => i === 0 ? {...x, sha: "c".repeat(40)} : x),
    files.map((x, i) => i === 1 ? {...x, sha: null} : x),
    files.map((x, i) => i === 2 ? {...x, status: "added"} : x),
    files.map((x, i) => i === 2 ? {...x, status: "removed"} : x),
    files.map((x, i) => i === 1 ? {...x, status: "renamed",
      previous_filename: "tests/hcm-old-regression.test.ts"} : x),
    [...files, {filename: "src/lib/hcm-governance.ts", status: "modified", sha: "c".repeat(40)}],
    [...files, {filename: "drizzle/0123_hcm_new.sql", status: "added", sha: "c".repeat(40)}],
    [...files, {filename: "tests/hcm-new-runtime.test.ts", status: "added", sha: "c".repeat(40)}],
    [...files, {filename: "scripts/qa/wfm-independent-witness.mjs",
      status: "added", sha: "c".repeat(40)}],
    [...files, {filename: ".github/workflows/payout.yml", status: "added", sha: "c".repeat(40)}],
  ];
  for (const changed of badSets) {
    assert.equal(classifyReviewScope(changed).hcmIntakeRegressionDevEvidence, false);
    const strict = review(changed);
    assert.equal(strict.ok, false);
    assert.ok(strict.blockers.includes("PILOT_HCM_WFM_FREEZE_ACTIVE"));
    const solo = await checkIndependentReview(soloEnv,
      fakeGithub({files: changed, reviews: []}).fetcher);
    assert.equal(solo.ok, false);
    assert.deepEqual(solo.blockers, ["PILOT_HCM_WFM_FREEZE_ACTIVE"]);
    assert.equal(solo.releaseAuthorized, false);
  }
});

test("WFM-691 offline witness packet permits only exact immutable #969 blobs, with no acceptance or release authority", async () => {
  const files = [
    {filename:"docs/qa/wfm-691-independent-witness-handoff.md",status:"added",sha:"4cbcc7bb09e21e0d836f4d52fb17750273bdd2bc"},
    {filename:"scripts/qa/wfm-independent-witness.mjs",status:"added",sha:"ed923d4bead1dab6f98583b59435fc494a773d1b"},
    {filename:"tests/wfm-independent-witness.test.mjs",status:"added",sha:"5dbfc80577b30365cf17573c1d19693cdb9ce3a0"},
  ];
  const scope = classifyReviewScope(files);
  assert.equal(scope.hcmWfmFrozen, true);
  assert.equal(scope.wfm691WitnessDevEvidence, true);
  assert.equal(review(files).ok, true);
  assert.equal(review(files).releaseAuthorized, false);
  const soloEnv = { ...env, INDEPENDENT_SOURCE_REVIEW_REQUIRED: "false",
    PAYROLL_INDEPENDENT_REVIEWERS: "", PILOT_HCM_WFM_STARTED: "false",
    PILOT_START_EVIDENCE_REF: "" };
  const authorizedSourceOnly = await checkIndependentReview(soloEnv,
    fakeGithub({files,reviews:[]}).fetcher);
  assert.equal(authorizedSourceOnly.ok,true);
  assert.equal(authorizedSourceOnly.mode,"solo-maintainer");
  assert.equal(authorizedSourceOnly.approvalCount,0);
  assert.equal(authorizedSourceOnly.releaseAuthorized,false);

  const rejected = [
    files.slice(0,2),
    [files[2]],
    [...files, {filename:"src/lib/wfm-roster.ts",status:"added",sha:"c".repeat(40)}],
    [...files, {filename:"drizzle/0123_wfm_new.sql",status:"added",sha:"c".repeat(40)}],
    [...files, {filename:".github/workflows/wfm-new-feature.yml",status:"added",sha:"c".repeat(40)}],
    files.map((x,i)=>i===0?{...x,sha:"c".repeat(40)}:x),
    files.map((x,i)=>i===1?{...x,sha:null}:x),
    files.map((x,i)=>i===2?{...x,status:"modified"}:x),
    files.map((x,i)=>i===1?{...x,status:"renamed",previous_filename:"scripts/qa/wfm-old.mjs"}:x),
    [files[0], files[0], files[2]],
  ];
  for (const altered of rejected) {
    assert.equal(classifyReviewScope(altered).wfm691WitnessDevEvidence,false);
    assert.equal(review(altered).ok,false);
    assert.ok(review(altered).blockers.includes("PILOT_HCM_WFM_FREEZE_ACTIVE"));
    const check=await checkIndependentReview(soloEnv,
      fakeGithub({files:altered,reviews:[]}).fetcher);
    assert.equal(check.ok,false);
    assert.deepEqual(check.blockers,["PILOT_HCM_WFM_FREEZE_ACTIVE"]);
    assert.equal(check.releaseAuthorized,false);
  }
});

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

test("solo source gate admits the approved legacy blob but not changed or additional frozen code", async () => {
  const file = { filename: "src/app/api/hcm/employment-term-decisions/[id]/evidence/route.ts",
    status: "modified", sha: "49957255191041ee83440bd7f24ea5cfd72d491c" };
  const solo = { ...env, INDEPENDENT_SOURCE_REVIEW_REQUIRED: "false" };
  const approved = await checkIndependentReview(solo, fakeGithub({ files: [file], reviews: [] }).fetcher);
  assert.equal(approved.ok, true);
  assert.equal(approved.releaseAuthorized, false);
  assert.equal(approved.approvalCount, 0);
  for (const files of [[{ ...file, sha: "0".repeat(40) }], [file,
    { filename: "src/lib/hcm-new.ts", status: "modified" }]]) {
    const blocked = await checkIndependentReview(solo, fakeGithub({ files, reviews: [] }).fetcher);
    assert.equal(blocked.ok, false);
    assert.ok(blocked.blockers.includes("PILOT_HCM_WFM_FREEZE_ACTIVE"));
  }
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

// This is a source-only exception pinned to the actual reviewed #896 head.
// A new commit on #896 requires a separate reviewed policy update.
const spendApprovedHead = "25e025e695965e0320a52cee06372304bc39ad58";
const spendNavigationFiles = [
  { filename: "tests/hcm-documents-policy-center.test.ts", status: "modified", sha: "67e95f68dfa1166e8bd7fcf798d75d9fe28ba4b4" },
  { filename: "tests/performance-self-assessment.test.ts", status: "modified", sha: "11b9dcae1fa140559db69a3ef078ea2286334d35" },
];
const reviewSpend = (files, extra = {}) => review(files, {
  pr: pr(files, { number: 896, head: { sha: spendApprovedHead } }),
  expectedHeadSha: spendApprovedHead,
  reviews: [{ ...human(), commit_id: spendApprovedHead }],
  ...extra,
});
const soloSpendEnv = { ...env, PR_NUMBER: "896", PR_HEAD_SHA: spendApprovedHead,
  INDEPENDENT_SOURCE_REVIEW_REQUIRED: "false", PAYROLL_INDEPENDENT_REVIEWERS: "",
  PILOT_HCM_WFM_STARTED: "false", PILOT_START_EVIDENCE_REF: "" };
const githubSpend = (files, extra = {}) => fakeGithub({
  files, number: 896, headSha: spendApprovedHead, reviews: [], ...extra,
});

test("approved exact #896 navigation blobs cross only the source freeze, never release authority", async () => {
  const files = [...spendNavigationFiles, moneyFile];
  assert.equal(classifyReviewScope(files).spendNavigationTests, true);
  assert.equal(reviewSpend(files).ok, true);
  assert.equal(reviewSpend(files).releaseAuthorized, false);
  const verdict = await checkIndependentReview(soloSpendEnv, githubSpend(files).fetcher);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.releaseAuthorized, false);
  assert.equal(verdict.approvalCount, 0);
  const denied = reviewSpend(files, { reviews: [] });
  assert.equal(denied.ok, false, "strict independent review remains required");
  assert.ok(denied.blockers.includes("CURRENT_HEAD_INDEPENDENT_APPROVAL_REQUIRED"));
  const draft = reviewSpend(files, {
    pr: pr(files, { number: 896, head: { sha: spendApprovedHead }, draft: true }),
  });
  assert.ok(draft.blockers.includes("SENSITIVE_PR_STILL_DRAFT"));
});

test("Spend exception denies a different PR number or newer head in strict and solo modes", async () => {
  const files = [...spendNavigationFiles, moneyFile];
  const wrongPr = reviewSpend(files, {
    pr: pr(files, { number: 100, head: { sha: spendApprovedHead } }),
  });
  assert.ok(wrongPr.blockers.includes("PILOT_HCM_WFM_FREEZE_ACTIVE"));
  const wrongHead = reviewSpend(files, {
    pr: pr(files, { number: 896, head: { sha } }),
    expectedHeadSha: sha, reviews: [human()],
  });
  assert.ok(wrongHead.blockers.includes("PILOT_HCM_WFM_FREEZE_ACTIVE"));
  const wrongPrSolo = await checkIndependentReview({
    ...soloSpendEnv, PR_NUMBER: "100",
  }, fakeGithub({ files, number: 100, headSha: spendApprovedHead, reviews: [] }).fetcher);
  assert.deepEqual(wrongPrSolo.blockers, ["PILOT_HCM_WFM_FREEZE_ACTIVE"]);
  const wrongHeadSolo = await checkIndependentReview({
    ...soloSpendEnv, PR_HEAD_SHA: sha,
  }, githubSpend(files, { headSha: sha }).fetcher);
  assert.deepEqual(wrongHeadSolo.blockers, ["PILOT_HCM_WFM_FREEZE_ACTIVE"]);
});

test("Spend navigation exception rejects changed bytes, omissions, duplicates, renames and extra frozen runtime", async () => {
  const cases = [
    spendNavigationFiles.slice(0, 1),
    [...spendNavigationFiles, spendNavigationFiles[0]],
    spendNavigationFiles.map((f, i) => i ? f : { ...f, sha: prior }),
    spendNavigationFiles.map((f, i) => i ? f : { ...f, sha: undefined }),
    spendNavigationFiles.map((f, i) => i ? f : { ...f, status: "added" }),
    spendNavigationFiles.map((f, i) => i ? f : { ...f, status: "renamed", previous_filename: "tests/hcm-old.test.ts" }),
    [...spendNavigationFiles, { filename: "src/lib/hcm-runtime.ts", status: "modified" }],
    [...spendNavigationFiles, { filename: "src/app/api/workforce/coverage/route.ts", status: "added" }],
    [...spendNavigationFiles, { filename: "docs/reassigned.txt", status: "renamed",
      previous_filename: "tests/hcm-documents-policy-center.test.ts" }],
    [...spendNavigationFiles, { filename: "docs/moved.txt", status: "renamed",
      previous_filename: "docs/old.txt" }],
    [...spendNavigationFiles, { filename: "docs/copied.txt", status: "copied",
      previous_filename: "tests/performance-self-assessment.test.ts" }],
    [...spendNavigationFiles, { filename: "docs/not-a-rename.txt", status: "modified",
      previous_filename: "tests/performance-self-assessment.test.ts" }],
  ];
  for (const files of cases) {
    assert.equal(classifyReviewScope(files).spendNavigationTests, false);
    const strict = reviewSpend(files);
    assert.ok(strict.blockers.includes("PILOT_HCM_WFM_FREEZE_ACTIVE"));
    const solo = await checkIndependentReview(soloSpendEnv, githubSpend(files).fetcher);
    assert.deepEqual(solo.blockers, ["PILOT_HCM_WFM_FREEZE_ACTIVE"]);
    assert.equal(solo.releaseAuthorized, false);
  }
});

const hcmIsolationFiles = [
  {
    "filename": ".github/workflows/multi-entity-browser-qa.yml",
    "status": "modified",
    "sha": "8010de61b6ecd2cc07fba10a59c5a4d186a3a163"
  },
  {
    "filename": "docs/qa/multi-entity-hcm-development-acceptance.md",
    "status": "added",
    "sha": "725af599a2a62ce7fb1f21b2e41f05760bed4bef"
  },
  {
    "filename": "scripts/ess-profile-synthetic-browser.mjs",
    "status": "modified",
    "sha": "405381550ea44af4995dc6152981571b70858f11"
  },
  {
    "filename": "scripts/hcm-request-lifecycle-browser.mjs",
    "status": "modified",
    "sha": "2bfc7cf619d0d75ee56ef17135414eb201c63bed"
  },
  {
    "filename": "src/app/api/hcm/effective-changes/route.ts",
    "status": "modified",
    "sha": "fb4bd6692a33a2130f0ec369fedc854334e718db"
  },
  {
    "filename": "src/app/api/hcm/lifecycle-readiness/route.ts",
    "status": "modified",
    "sha": "a093e0edcbfbed3d07752ee89717abc4a069810f"
  },
  {
    "filename": "src/app/api/hcm/people-operations-inbox/route.ts",
    "status": "modified",
    "sha": "71d8f6510ceb2dce1316a04bebf0bff6553cf4e2"
  },
  {
    "filename": "src/components/hcm-employment-lifecycle-action-center.tsx",
    "status": "modified",
    "sha": "fc7cd323e2ea1c851207cd3b3ff37ed33c4b8c80"
  },
  {
    "filename": "src/components/hcm-people-operations-inbox.tsx",
    "status": "modified",
    "sha": "abf4a0cab717f41618913eb96f581ef2a95775d7"
  },
  {
    "filename": "src/components/workspace/people.tsx",
    "status": "modified",
    "sha": "66265f277742ec0159a7699fe367cba63687ce48"
  },
  {
    "filename": "src/lib/hcm-client-employer-scope.ts",
    "status": "added",
    "sha": "5d85973f9b5a95767a0e63644aa2ec4413094eff"
  },
  {
    "filename": "src/lib/hcm-effective-changes.ts",
    "status": "modified",
    "sha": "5e11f82d184a135012955ddee79998ac0fa4481d"
  },
  {
    "filename": "src/lib/hcm-lifecycle-readiness-server.ts",
    "status": "modified",
    "sha": "2c4665b9ddf691a615dd75484d41c47495f48730"
  },
  {
    "filename": "src/lib/hcm-people-operations-inbox-server.ts",
    "status": "modified",
    "sha": "6a86c8c719f21deba0b97372a273450274475207"
  },
  {
    "filename": "tests/fixtures/hcm-request-lifecycle.jsx",
    "status": "modified",
    "sha": "90681980f7bb997a4fa13bf1b101d04e10a778b5"
  },
  {
    "filename": "tests/hcm-client-employer-scope.test.ts",
    "status": "added",
    "sha": "a9776ee4f4211f57ec4016fcf1cfca8a565e6205"
  },
  {
    "filename": "tests/hcm-people-intelligence.test.ts",
    "status": "modified",
    "sha": "e6dd544c5597bf4a31586fe12723edfa9ad31893"
  },
  {
    "filename": "tests/hcm-people-operations-inbox.test.ts",
    "status": "modified",
    "sha": "bc3d6fe973449b480745675741d642a9031d38bb"
  },
  {
    "filename": "tests/hcm-people-ops-daily-triage.test.ts",
    "status": "modified",
    "sha": "0d01a88ba391588c6c6001fb5ba87b260e2a0960"
  },
  {
    "filename": "tests/multi-entity-isolation-db.test.ts",
    "status": "modified",
    "sha": "361ba2cfcd23e12df3773794ac6439df2767c34a"
  },
  {
    "filename": "tests/workforce-enterprise-analytics.test.ts",
    "status": "modified",
    "sha": "36abb56cf1fd137c2a174b15984e3ace011bf834"
  }
];
const hcmApprovedHead = "2c0dc90e1cc6994928cd43eaabe250380ca554ce";
const hcmSolo = { ...env, PR_NUMBER: "963", PR_HEAD_SHA: hcmApprovedHead,
  INDEPENDENT_SOURCE_REVIEW_REQUIRED: "false", PILOT_HCM_WFM_STARTED: "false",
  PILOT_START_EVIDENCE_REF: "" };
const reviewHcm = (files, extra = {}) => review(files, {
  pr: pr(files, { number: 963, head: { sha: hcmApprovedHead } }),
  expectedHeadSha: hcmApprovedHead,
  reviews: [{ ...human(), commit_id: hcmApprovedHead }], ...extra,
});
test("approved exact HCM isolation source crosses source freeze without runtime or release authority", async () => {
  assert.equal(reviewHcm(hcmIsolationFiles).ok, true);
  assert.equal(reviewHcm(hcmIsolationFiles).releaseAuthorized, false);
  const verdict = await checkIndependentReview(hcmSolo, fakeGithub({
    files: hcmIsolationFiles, number: 963, headSha: hcmApprovedHead, reviews: [],
  }).fetcher);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.releaseAuthorized, false);
  assert.ok(reviewHcm(hcmIsolationFiles, { reviews: [] }).blockers.includes("CURRENT_HEAD_INDEPENDENT_APPROVAL_REQUIRED"));
});
test("HCM isolation exception rejects cross-PR/head reuse and any changed diff", async () => {
  const mutated = [
    hcmIsolationFiles.slice(1),
    [...hcmIsolationFiles, hcmIsolationFiles[0]],
    [...hcmIsolationFiles, { filename: "docs/extra.md", status: "added", sha }],
    hcmIsolationFiles.map((f,i) => i ? f : { ...f, sha: prior }),
    hcmIsolationFiles.map((f,i) => i ? f : { ...f, sha: undefined }),
    hcmIsolationFiles.map((f,i) => i ? f : { ...f, status: "deleted" }),
    hcmIsolationFiles.map((f,i) => i ? f : { ...f, status: "renamed", previous_filename: "src/lib/hcm-other.ts" }),
  ];
  for (const files of mutated) {
    assert.ok(reviewHcm(files).blockers.includes("PILOT_HCM_WFM_FREEZE_ACTIVE"));
    const verdict = await checkIndependentReview(hcmSolo, fakeGithub({ files,
      number: 963, headSha: hcmApprovedHead, reviews: [], }).fetcher);
    assert.ok(verdict.blockers.includes("PILOT_HCM_WFM_FREEZE_ACTIVE"));
  }
  for (const [number, headSha] of [[964,hcmApprovedHead],[963,sha]]) {
    const verdict = await checkIndependentReview({ ...hcmSolo, PR_NUMBER: String(number), PR_HEAD_SHA: headSha },
      fakeGithub({ files: hcmIsolationFiles, number, headSha, reviews: [] }).fetcher);
    assert.ok(verdict.blockers.includes("PILOT_HCM_WFM_FREEZE_ACTIVE"));
  }
});

/**
 * Owner's 14 Oct dev-only waiver covers exactly the previously regression-
 * tested PR #902 source. It never grants human review or payroll release.
 * Construct the expected immutable file inventory independently of the
 * policy's own private array to catch substitutions/removals.
 */
const pinnedVault902Head = "94435b43f98de209065a373d4959af3db8e14b69";
const pinnedVault902Files = [
  { filename: ".github/workflows/a5-private-object-acceptance.yml", status: "added", sha: "f4c43d83b740afad65763fb24674682664f0ae1f" },
  { filename: ".github/workflows/a5-vault-migration-rehearsal.yml", status: "added", sha: "ad4052c14e5a9dee8908835100cb526a66e643a2" },
  { filename: ".github/workflows/a5-vault-minio-acceptance.yml", status: "added", sha: "92a37ff962a13cf3d6603ffcc4b528c9a358d367" },
  { filename: "docs/engineering/employee-document-vault-migration-plan.md", status: "added", sha: "b890cd26ff47b332340b3928d31c3733f16ea57a" },
  { filename: "docs/engineering/employee-vault-independent-acceptance.md", status: "added", sha: "724d4b948e7bc0176a01b8e551d46e4d6f19bfc3" },
  { filename: "docs/engineering/migration-proposals/employee-document-vault-a5.sql", status: "added", sha: "e24dd2af2a60ad1d33c45dac65e9a7751e5274b4" },
  { filename: "scripts/a5-local-private-object-acceptance.ts", status: "added", sha: "f69bfbf41f7eb7f1ef88be6fe75fce49ec616a02" },
  { filename: "scripts/accept-private-employee-vault-minio.ts", status: "added", sha: "0880aeed4c685f3409c490db84ac211cae0012aa" },
  { filename: "scripts/check-a5-legacy-document-schema.ts", status: "added", sha: "c91cc885eec1c3b584584399e11862766d8570db" },
  { filename: "scripts/rehearse-employee-document-vault-migration.cjs", status: "added", sha: "7d4ec4ca4f4fca2dcc432d9eb41211b7623b026a" },
  { filename: "src/app/api/documents/route.ts", status: "modified", sha: "41236b2e6f734590ea092869261851d3d6b6800c" },
  { filename: "src/app/api/hcm/documents/route.ts", status: "modified", sha: "cdf57b3fff05f228676916497fa91e413f5d0a84" },
  { filename: "src/app/api/self/documents/route.ts", status: "modified", sha: "30ba92e5095e9244a3892906b014a45eba3e0f2a" },
  { filename: "src/components/employee-documents-panel.tsx", status: "modified", sha: "cc4d9ba3c3d7ba726aa739bb98b42575611cd3ac" },
  { filename: "src/components/hcm-documents-panel.tsx", status: "modified", sha: "c79110a5e382e31ea597f16deb697a38a0b55371" },
  { filename: "src/db/schema.ts", status: "modified", sha: "24a1a4138285af40b308b86c7f05584521b5e812" },
  { filename: "src/lib/automation-document-generation.ts", status: "modified", sha: "441bcddb0e7347d5430a665bc0e87e14725b9e13" },
  { filename: "src/lib/data-retention.ts", status: "modified", sha: "475b5a160b0754746b52dce00741c1c244ac4fe2" },
  { filename: "src/lib/document-object-storage.ts", status: "modified", sha: "649f9d862abca126e37f1ba751d285a7093c4c3d" },
  { filename: "src/lib/document-schema-compat.ts", status: "modified", sha: "5792b12e5b250327fd2cac05d170f00a7042b120" },
  { filename: "src/lib/employee-document-vault-verification.ts", status: "added", sha: "8a22aff65a59eae3b3c04dc9ad8d1b292e009c42" },
  { filename: "src/lib/employee-vault-object-reconciliation.ts", status: "added", sha: "0b1813421cdef8f32747145db4697745cc31d3a7" },
  { filename: "src/lib/hcm-documents.ts", status: "modified", sha: "7a40bd59f1a8308d67c3eb7f4ce750545aad4c36" },
  { filename: "tests/a4-a5-retention-schema-regression.test.ts", status: "added", sha: "ce77d4bb40fa178711b29bc0b001c89918cf8b42" },
  { filename: "tests/automation-document-generation.test.ts", status: "modified", sha: "adc93abc5e754b002fbd01fb360432d21737ebb8" },
  { filename: "tests/employee-document-expiry-integration.test.ts", status: "added", sha: "4e4a64d91f28f38093766ac8dbd8174882b35325" },
  { filename: "tests/employee-document-vault-generated.test.ts", status: "added", sha: "869aac6077808bdb42d3d7cfd33f9c9daf4204cc" },
  { filename: "tests/employee-document-vault-verification.test.ts", status: "added", sha: "b5dcfa9491a8fad40031e069cd10cfd64c41bc46" },
  { filename: "tests/employee-document-vault.test.ts", status: "added", sha: "e83c2c8355155d3ea1dbc3942a0a8fd35e60a12b" },
  { filename: "tests/employee-vault-ess-link-isolation.test.ts", status: "added", sha: "8fcf1eff3a03cc5fcb8d12ba34d7c6ecb0e184ba" },
  { filename: "tests/employee-vault-ess-policy-link-isolation.test.ts", status: "added", sha: "b57977a1eb5452a48d54241d348d93ff6a9eca87" },
  { filename: "tests/employee-vault-flag-rollback.test.ts", status: "added", sha: "e08e88196c7e2e3f83582077a7b23aba3491d9b2" },
  { filename: "tests/employee-vault-object-reconciliation.test.ts", status: "added", sha: "1cc825fa34bc580317358f32e3e547d88ead58f7" },
  { filename: "tests/fixtures/minio/Dockerfile", status: "added", sha: "0a40a53628c27562627ef579e021cea995581100" },
];
const vault902Pr = (files, extras = {}) => pr(files, {
  number: 902, head: { sha: pinnedVault902Head }, draft: false, ...extras,
});
const vault902SoloEnv = {
  ...env, PR_NUMBER: "902", PR_HEAD_SHA: pinnedVault902Head,
  INDEPENDENT_SOURCE_REVIEW_REQUIRED: "false",
  PAYROLL_INDEPENDENT_REVIEWERS: "",
  PILOT_HCM_WFM_STARTED: "false", PILOT_START_EVIDENCE_REF: "",
};
const mockVault902 = (files, extra = {}) => fakeGithub({
  files, number: 902, headSha: pinnedVault902Head, reviews: [], ...extra,
});

test("owner-pinned #902 exact 34-file source crosses freeze but never grants independent approval or production release", async () => {
  assert.equal(pinnedVault902Files.length, 34);
  const matchingPr = vault902Pr(pinnedVault902Files);
  assert.equal(isApprovedVault902Source(matchingPr, pinnedVault902Files), true);
  const scope = classifyReviewScope(pinnedVault902Files);
  assert.equal(scope.hcmWfmFrozen, true);
  assert.equal(scope.frozenFileCount, 3, "only HCM documents route, panel, and helper cross the freeze");
  assert.equal(scope.requiresIndependentHuman, true);

  const solo = await checkIndependentReview(vault902SoloEnv, mockVault902(pinnedVault902Files).fetcher);
  assert.equal(solo.ok, true);
  assert.deepEqual(solo.blockers, []);
  assert.equal(solo.mode, "solo-maintainer");
  assert.equal(solo.approvalCount, 0, "no human approval was fabricated");
  assert.equal(solo.releaseAuthorized, false);

  const strictApproved = review(pinnedVault902Files, {
    pr: matchingPr, expectedHeadSha: pinnedVault902Head,
    reviews: [{ ...human(), commit_id: pinnedVault902Head }],
  });
  assert.equal(strictApproved.ok, true);
  assert.equal(strictApproved.releaseAuthorized, false);
  assert.equal(strictApproved.blockers.includes("PILOT_HCM_WFM_FREEZE_ACTIVE"), false);

  const strictUnapproved = review(pinnedVault902Files, {
    pr: matchingPr, expectedHeadSha: pinnedVault902Head, reviews: [],
  });
  assert.equal(strictUnapproved.ok, false);
  assert.ok(strictUnapproved.blockers.includes("CURRENT_HEAD_INDEPENDENT_APPROVAL_REQUIRED"),
    "strict mode still requires an actual current-head independent approval");

  const draftStrict = review(pinnedVault902Files, {
    pr: vault902Pr(pinnedVault902Files, { draft: true }),
    expectedHeadSha: pinnedVault902Head,
    reviews: [{ ...human(), commit_id: pinnedVault902Head }],
  });
  assert.ok(draftStrict.blockers.includes("SENSITIVE_PR_STILL_DRAFT"),
    "source exception must not let a sensitive draft pass strict policy");
});

test("A5 freeze exception refuses any omitted, copied, moved, duplicate, extra or mutated GitHub diff entry", async () => {
  const files = pinnedVault902Files;
  const altered = [
    files.slice(1),
    [...files, files[0]],
    [...files, { filename: "docs/extra-vault-scope.md", status: "added", sha }],
    [...files, { filename: "src/app/api/workforce/coverage/route.ts", status: "modified", sha }],
    files.map((f, i) => i ? f : { ...f, sha: prior }),
    files.map((f, i) => i ? f : { ...f, sha: undefined }),
    files.map((f, i) => i !== 11 ? f : { ...f, sha: prior }),
    files.map((f, i) => i !== 14 ? f : { ...f, sha: prior }),
    files.map((f, i) => i !== 22 ? f : { ...f, sha: prior }),
    files.map((f, i) => i ? f : { ...f, status: "modified" }),
    files.map((f, i) => i !== 11 ? f : { ...f, status: "added" }),
    files.map((f, i) => i ? f : { ...f, status: "renamed", previous_filename: "src/components/hcm-documents-panel.old.tsx" }),
    files.map((f, i) => i ? f : { ...f, status: "copied", previous_filename: "docs/old.md" }),
    files.map((f, i) => i ? f : { ...f, previous_filename: "src/app/api/hcm/documents/route.ts" }),
  ];
  for (const fileSet of altered) {
    assert.equal(isApprovedVault902Source(vault902Pr(fileSet), fileSet), false);
    const strict = review(fileSet, {
      pr: vault902Pr(fileSet), expectedHeadSha: pinnedVault902Head,
      reviews: [{ ...human(), commit_id: pinnedVault902Head }],
    });
    assert.ok(strict.blockers.includes("PILOT_HCM_WFM_FREEZE_ACTIVE"),
      "strict freeze must reject any expanded or changed source diff");
    const solo = await checkIndependentReview(vault902SoloEnv, mockVault902(fileSet).fetcher);
    assert.deepEqual(solo.blockers, ["PILOT_HCM_WFM_FREEZE_ACTIVE"],
      "solo mode must not turn a changed diff into an approved source exception");
    assert.equal(solo.releaseAuthorized, false);
  }
});

test("#902 exception is unusable by any other PR, head, or unrelated HCM/WFM source", async () => {
  const files = pinnedVault902Files;
  const otherPr = { ...vault902SoloEnv, PR_NUMBER: "903" };
  const wrongNumber = await checkIndependentReview(otherPr,
    mockVault902(files, { number: 903 }).fetcher);
  assert.deepEqual(wrongNumber.blockers, ["PILOT_HCM_WFM_FREEZE_ACTIVE"]);

  const futureHead = "c".repeat(40);
  const newHeadEnv = { ...vault902SoloEnv, PR_HEAD_SHA: futureHead };
  const wrongHead = await checkIndependentReview(newHeadEnv,
    mockVault902(files, { headSha: futureHead }).fetcher);
  assert.deepEqual(wrongHead.blockers, ["PILOT_HCM_WFM_FREEZE_ACTIVE"]);
  assert.equal(isApprovedVault902Source(vault902Pr(files, { head: { sha: futureHead } }), files), false);

  const unrelatedFrozen = [{
    filename: "src/app/api/hcm/people-operations-inbox/route.ts",
    status: "modified", sha: pinnedVault902Files[11].sha,
  }];
  assert.equal((await checkIndependentReview(vault902SoloEnv,
    mockVault902(unrelatedFrozen).fetcher)).ok, false,
    "unrelated HCM change stays frozen even when #902 owns the PR number/head");
  assert.ok(review(unrelatedFrozen).blockers.includes("PILOT_HCM_WFM_FREEZE_ACTIVE"));
});
