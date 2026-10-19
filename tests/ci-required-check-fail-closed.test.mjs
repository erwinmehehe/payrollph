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
  assert.ok(check.includes("needs: [test-shard, audit-chain-protection]"));
  // always() defeats GitHub's implicit success() after an upstream shard failure.
  assert.ok(check.includes("if: ${{ always() && (needs.test-shard.result != 'success' || needs.audit-chain-protection.result != 'success') }}"));
  assert.ok(check.includes("exit 1"));
  const guard = check.indexOf("Required CI needs both regression shards and audit-chain-protection");
  const normalWork = check.indexOf("- uses: actions/checkout@");
  assert.ok(guard > 0 && normalWork > guard,
    "required aggregate must error before subsequent lint/goldens/build");
  assert.ok(workflow.includes("  audit-chain-protection:\n"), "audit-chain aggregate must exist");
  assert.ok(workflow.includes("needs: audit-chain-real-logins"), "audit-chain gate must await its login matrix");
  assert.ok(workflow.includes("run: node scripts/run-sharded-tests.mjs"));
  // The 4 matrix members must remain independent and complete.
  assert.ok(workflow.includes("shard: [0, 1, 2, 3]"));
});
