import assert from "node:assert/strict";
import test from "node:test";
import { isDocsOnly } from "../scripts/ci/change-scope.mjs";

test("only ordinary Markdown in approved documentation locations bypasses heavy CI", () => {
  assert.equal(isDocsOnly(["README.md", "docs/engineering/release-tagging.md"]), true);
  assert.equal(isDocsOnly(["CONTRIBUTING.md", "CHANGELOG.md"]), true);
  assert.equal(isDocsOnly(["docs/security/runbook.md"]), true);
  assert.equal(isDocsOnly([".github/PULL_REQUEST_TEMPLATE.md"]), true);
});

test("MDX is potentially executable and must trigger the full checks", () => {
  assert.equal(isDocsOnly(["docs/overview.mdx"]), false);
  assert.equal(isDocsOnly(["src/app/payroll/page.mdx"]), false);
  assert.equal(isDocsOnly(["README.md", "docs/candidate.mdx"]), false);
});

test("non-doc or mixed changes must trigger the full suite", () => {
  for (const path of [
    "src/lib/payroll-engine.ts",
    "tests/tenant-platform-controls-family.test.mjs",
    "docs/scripts/fixture.sh",
    ".github/workflows/ci.yml",
    "package-lock.json",
    "src/app/README.md",
    "scripts/README.md",
    "tests/fixtures/README.md",
    "public/page.md",
  ]) {
    assert.equal(isDocsOnly([path]), false, path);
  }
  assert.equal(isDocsOnly(["README.md", "src/lib/payroll-engine.ts"]), false);
});

test("empty, malformed, traversal-like or unexpected paths fail closed", () => {
  for (const files of [
    [], null, [""], ["../foo.md"], ["docs/a/../foo.md"],
    ["docs//foo.md"], ["docs/foo.mdx"], ["docs/foo.md/"],
    ["docs/foo.md", "foo\0.md"], ["docs\\foo.md"],
  ]) assert.equal(isDocsOnly(files), false, JSON.stringify(files));
});
