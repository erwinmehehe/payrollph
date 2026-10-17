import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// The required "check" job fails closed when a regression shard is cancelled
// (see ci-required-check-fail-closed.test.mjs). Cancelling a main-branch run
// because a newer merge landed therefore turned that commit's required check
// red without any test failing. On 2026-10-17, 5d8a69068 and d31b89711 were
// cancelled 3-4 minutes in by the next merge to main.
test("CI never cancels a run for a push to main, but still supersedes PR runs", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const block = workflow.split("\nconcurrency:\n")[1]?.split("\npermissions:")[0] ?? "";
  assert.ok(block, "ci.yml must declare a concurrency block");
  // Cancellation is limited to pull_request events.
  assert.match(block, /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
  assert.doesNotMatch(block, /cancel-in-progress: true/);
  // Main pushes are keyed by commit, so two merges can never share a group.
  assert.match(block, /group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.event\.pull_request\.number \|\| github\.sha \}\}/);
  assert.doesNotMatch(block, /github\.ref \}\}/);
});
