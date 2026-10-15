import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// Permanent regression for #737 after the controlled negative-head proof.
// The intentional failure existed only on unmerged SHA
// 60e7cb03fbaa6ecfe4dcae77c9796f8e7402e213.
test("#737 required check materializes and fails when matrix shard fails", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const check = workflow.split("\n  check:\n")[1];
  assert.ok(check);
  assert.ok(check.includes("if: ${{ always() }}"));
  assert.ok(check.includes("needs: test-shard"));
  assert.ok(check.includes("if: ${{ needs.test-shard.result != 'success' }}"));
  assert.ok(check.includes("exit 1"));
  const guard = check.indexOf("Required CI cannot pass unless every regression shard succeeded");
  const normalWork = check.indexOf("- uses: actions/checkout@");
  assert.ok(guard > 0 && normalWork > guard,
    "required aggregate must error before subsequent lint/goldens/build");
  assert.ok(workflow.includes("run: node scripts/run-sharded-tests.mjs"));
  // The 4 matrix members must remain independent and complete.
  assert.ok(workflow.includes("shard: [0, 1, 2, 3]"));
});
