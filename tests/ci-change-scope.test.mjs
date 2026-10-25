import assert from "node:assert/strict";
import test from "node:test";
import { isDocsOnly } from "../scripts/ci/change-scope.mjs";

test("Markdown-only PRs can bypass heavy checks", () => {
  assert.equal(isDocsOnly(["README.md", "docs/engineering/release-tagging.md"]), true);
  assert.equal(isDocsOnly(["docs/overview.mdx"]), true);
  assert.equal(isDocsOnly([".github/PULL_REQUEST_TEMPLATE.md"]), true);
});

test("mixed PRs, executable paths, and CI changes require the full suite", () => {
  assert.equal(isDocsOnly(["docs/notes.md", "src/lib/payroll-engine.ts"]), false);
  assert.equal(isDocsOnly(["tests/tenant-platform-controls-family.test.mjs"]), false);
  assert.equal(isDocsOnly(["docs/scripts/fixture.sh"]), false);
  assert.equal(isDocsOnly([".github/workflows/ci.yml"]), false);
  assert.equal(isDocsOnly(["README.md", "package-lock.json"]), false);
});

test("empty, invalid, or traversal-like file lists fail closed", () => {
  assert.equal(isDocsOnly([]), false);
  assert.equal(isDocsOnly(null), false);
  assert.equal(isDocsOnly([""]), false);
  assert.equal(isDocsOnly(["../foo.md"]), false);
  assert.equal(isDocsOnly(["README.md", "foo\0.md"]), false);
});
