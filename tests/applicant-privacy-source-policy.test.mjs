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


test("applicant privacy source remains sensitive and admits solo review without freeze exceptions", async () => {
  assert.equal(classifyReviewScope(files).hcmWfmFrozen,false);
  assert.equal(classifyReviewScope(files).requiresIndependentHuman,true);
  const result = await checkIndependentReview(env,api(files));
  assert.equal(result.ok,true);
  assert.equal(result.releaseAuthorized,false);
  assert.equal(result.approvalCount,0);
  const strict = evaluateIndependentReview({pr:pr(files),files,expectedHeadSha:head,
    reviews:[],reviewerAllowlist:"reviewer",permissions:{reviewer:"write"}});
  assert.ok(strict.blockers.includes("CURRENT_HEAD_INDEPENDENT_APPROVAL_REQUIRED"));
  assert.equal(strict.releaseAuthorized,false);
});
test("privacy source changes do not require a pinned blob but full head/diff validation remains", async () => {
  const changed = [...files.map(f=>({...f,sha:"b".repeat(40)})),
    {filename:"src/lib/hcm-extra.ts",status:"added"}];
  assert.equal((await checkIndependentReview(env,api(changed))).ok,true);
  await assert.rejects(()=>checkIndependentReview({...env,PR_HEAD_SHA:"c".repeat(40)},api(changed)),
    /REVIEW_GATE_PR_HEAD_OR_FILE_SET_UNVERIFIED/);
  const incomplete = async (url,request)=>url.endsWith("/pulls/925")
    ? Response.json(pr(changed)) : api(files)(url,request);
  await assert.rejects(()=>checkIndependentReview(env,incomplete),/REVIEW_GATE_FULL_DIFF_NOT_AVAILABLE/);
});
