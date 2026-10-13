import assert from "node:assert/strict";
import test from "node:test";
import { files } from "./fixtures/applicant-privacy-source-files.mjs";
import { classifyReviewScope, evaluateIndependentReview } from "../scripts/lib/independent-pr-review-policy.mjs";
import { checkIndependentReview } from "../scripts/check-independent-pr-review.mjs";

const head = "a".repeat(40);
const env = { GITHUB_REPOSITORY: "erwinmehehe/payrollph", GITHUB_TOKEN: "synthetic-token",
  PR_NUMBER: "925", PR_HEAD_SHA: head, INDEPENDENT_SOURCE_REVIEW_REQUIRED: "false" };
function pr(changed) { return { number: 925, state: "open", base: { ref: "main" }, head: { sha: head },
  user: { login: "author" }, draft: false, changed_files: changed.length }; }
function api(changed) {
  return async (url, request) => {
    assert.equal(request.method, "GET", "Review gate cannot write GitHub or activate anything");
    const body = url.endsWith("/pulls/925") ? pr(changed)
      : url.includes("/files?") ? (new URL(url).searchParams.get("page") === "1" ? changed : []) : [];
    return Response.json(body);
  };
}

test("owner exception admits only the complete immutable applicant-privacy source delta", async () => {
  assert.equal(classifyReviewScope(files).applicantPrivacySource, true);
  assert.equal(classifyReviewScope(files).hcmWfmFrozen, true);
  assert.equal(classifyReviewScope(files).requiresIndependentHuman, true, "Sensitivity is preserved");
  const result = await checkIndependentReview(env, api(files));
  assert.equal(result.ok, true);
  assert.equal(result.releaseAuthorized, false);
  assert.equal(result.approvalCount, 0, "No fabricated human approval");
  const strict = evaluateIndependentReview({ pr: pr(files), files, expectedHeadSha: head,
    reviews: [], reviewerAllowlist: "reviewer", permissions: { reviewer: "write" } });
  assert.equal(strict.ok, false, "Strict reviewer mode still requires its actual review");
  assert.equal(strict.blockers.includes("PILOT_HCM_WFM_FREEZE_ACTIVE"), false);
});

test("changed bytes, status, missing/duplicate/renamed/extra paths restore the normal freeze", async () => {
  const changed = [];
  for (let index = 0; index < files.length; index++) {
    changed.push(files.map((file, i) => i === index ? { ...file, sha: "0".repeat(40) } : file));
    changed.push(files.map((file, i) => i === index ? { ...file, sha: undefined } : file));
    changed.push(files.map((file, i) => i === index ? { ...file, status: "removed" } : file));
    changed.push(files.map((file, i) => i === index ? { ...file, status: "renamed", previous_filename: "src/lib/hcm-other.ts" } : file));
  }
  changed.push(files.slice(1), [...files, files[0]]);
  for (const filename of ["src/lib/hcm-extra.ts", "src/lib/payroll-engine.ts", "drizzle/0124_extra.sql", ".github/workflows/extra.yml", "tests/extra.test.ts"]) {
    changed.push([...files, { filename, sha: "b".repeat(40), status: "added" }]);
  }
  for (const candidate of changed) {
    assert.equal(classifyReviewScope(candidate).applicantPrivacySource, false);
    const result = await checkIndependentReview(env, api(candidate));
    assert.equal(result.ok, false);
    assert.ok(result.blockers.includes("PILOT_HCM_WFM_FREEZE_ACTIVE"));
    assert.equal(result.releaseAuthorized, false);
  }
});
