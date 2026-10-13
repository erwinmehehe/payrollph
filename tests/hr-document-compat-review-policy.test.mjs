import assert from "node:assert/strict";
import test from "node:test";
import { classifyReviewScope } from "../scripts/lib/independent-pr-review-policy.mjs";
const file = {
  filename: "src/app/api/hcm/employment-term-decisions/[id]/evidence/route.ts",
  status: "modified", sha: "49957255191041ee83440bd7f24ea5cfd72d491c",
};
test("only owner-approved exact legacy document compatibility blob qualifies", () => {
  assert.equal(classifyReviewScope([file]).hrDocumentLegacyCompatibility, true);
  assert.equal(classifyReviewScope([file, { filename: "src/lib/hr-case-policy.ts", status: "modified" }]).hrDocumentLegacyCompatibility, true);
  for (const files of [
    [{ ...file, sha: undefined }], [{ ...file, sha: "0".repeat(40) }],
    [{ ...file, status: "added" }], [{ ...file, status: "renamed", previous_filename: "src/lib/hcm-other.ts" }],
    [file, file], [file, { filename: "src/lib/hcm-new.ts", status: "modified" }],
    [file, { filename: "src/lib/workforce-new.ts", status: "modified" }],
  ]) {
    assert.equal(classifyReviewScope(files).hrDocumentLegacyCompatibility, false);
    assert.equal(classifyReviewScope(files).hcmWfmFrozen, true);
  }
});
