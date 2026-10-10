import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

/** Run offline post-merge gate fixtures in the normal TypeScript CI suite. */
test("merged Automation Studio remains fail-closed without independent activation evidence", () => {
  const child = spawnSync(process.execPath,
    ["--test", resolve("tests/verify-automation-postmerge-activation.test.mjs")],
    { encoding: "utf8", timeout: 20_000 });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, 0,
    "Post-merge gate tests failed:\n" + (child.stdout ?? "") + "\n" + (child.stderr ?? ""));
});
