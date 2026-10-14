import assert from "node:assert/strict";
import test from "node:test";
import { classifyReviewScope, evaluateIndependentReview } from "../scripts/lib/independent-pr-review-policy.mjs";
const file = { filename: "src/app/api/hcm/employment-term-decisions/[id]/evidence/route.ts", status: "modified" };
const head = "a".repeat(40);
test("HCM document source remains sensitive but no longer needs an exact freeze exception", () => {
  for (const files of [[file], [{ ...file, sha: "0".repeat(40) }],
    [file, { filename: "src/lib/hcm-new.ts", status: "added" }]]) {
    const scope = classifyReviewScope(files);
    assert.equal(scope.requiresIndependentHuman,true);
    assert.equal(scope.hcmWfmFrozen,false);
    assert.equal(scope.frozenFileCount,0);
    const verdict = evaluateIndependentReview({ files, expectedHeadSha:head,
      pr:{number:888,state:"open",base:{ref:"main"},head:{sha:head},user:{login:"author"},draft:false,changed_files:files.length},
      reviews:[],reviewerAllowlist:"reviewer",permissions:{reviewer:"write"} });
    assert.ok(verdict.blockers.includes("CURRENT_HEAD_INDEPENDENT_APPROVAL_REQUIRED"));
    assert.equal(verdict.releaseAuthorized,false);
  }
});
