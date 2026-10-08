import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

/**
 * Include the read-only release gate's standalone .mjs tests in the regular
 * tsx --test tests/*.test.ts CI command without ever calling GitHub or needing
 * a secret. Actual release approval is checked only by an authorized operator.
 */
test("Automation Studio release-gate evaluator passes isolated fail-closed fixtures", () => {
  const child = spawnSync(
    process.execPath,
    ["--test", resolve("tests/verify-automation-language-release.test.mjs")],
    { encoding: "utf8", timeout: 20_000 },
  );
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(
    child.status,
    0,
    `Release-gate test fixtures failed:\n${child.stdout ?? ""}\n${child.stderr ?? ""}`,
  );
  assert.match(child.stdout, /# fail 0/);
});
