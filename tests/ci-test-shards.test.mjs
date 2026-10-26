import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { regressionFiles, selectRegressionShard, regressionTestArguments } from "../scripts/run-sharded-tests.mjs";

test("four CI shards include every TypeScript and MJS regression exactly once", () => {
  const inventory = regressionFiles();
  assert.ok(inventory.some((name) => name.endsWith(".test.ts")));
  assert.ok(inventory.some((name) => name.endsWith(".test.mjs")));
  const groups = [0, 1, 2, 3].map((index) => selectRegressionShard(inventory, index, 4));
  const members = groups.flat();
  assert.equal(members.length, inventory.length);
  assert.deepEqual(members.slice().sort(), inventory.slice().sort());
  assert.equal(new Set(members).size, inventory.length);
  assert.ok(groups.every((group) => group.length > 0));
});

test("shard selection is stable and invalid arguments fail closed", () => {
  const sample = ["a.test.ts", "b.test.ts", "c.test.mjs", "d.test.ts", "e.test.ts"];
  assert.deepEqual(selectRegressionShard(sample, 0, 2), ["a.test.ts", "c.test.mjs", "e.test.ts"]);
  assert.deepEqual(selectRegressionShard(sample, 1, 2), ["b.test.ts", "d.test.ts"]);
  for (const [index, total] of [[-1, 4], [4, 4], [0, 0], [0, 33], [0.5, 4], [0, NaN]]) {
    assert.throws(() => selectRegressionShard(sample, index, total), /INVALID_REGRESSION_SHARD/);
  }
});

test("CI aggregates all regression shards, audit chain and parallel validation without masking failures", () => {
  const source = readFileSync(".github/workflows/ci.yml", "utf8");
  const regression = source.split("\n  test-shard:\n")[1]?.split("\n  audit-chain-real-logins:\n")[0];
  const audit = source.split("\n  audit-chain-protection:\n")[1]?.split("\n  validation:\n")[0];
  const validation = source.split("\n  validation:\n")[1]?.split("\n  check:\n")[0];
  const gate = source.split("\n  check:\n")[1];
  assert.ok(regression && audit && validation && gate, "required CI jobs must exist");
  assert.ok(regression.includes("shard: [0, 1, 2, 3]"));
  assert.ok(regression.includes("run: node scripts/run-sharded-tests.mjs"));
  assert.ok(regression.includes("image: postgres:16"));
  assert.ok(validation.includes("needs: change-scope"), "validation must wait for a valid classifier");
  assert.ok(!validation.includes("needs: [test-shard"), "validation should run in parallel");
  assert.ok(audit.includes("needs: [change-scope, audit-chain-real-logins]"));
  assert.ok(audit.includes('if [ "$MATRIX_RESULT" != "success" ]; then'),
    "all PG16/PG18 audit cases must succeed");
  // A failure anywhere in the matrix must never skip the required status.
  assert.ok(gate.includes("if: ${{ always() }}"), "the required job cannot disappear after a failure");
  assert.ok(gate.includes("needs: [change-scope, test-shard, audit-chain-protection, validation]"));
  for (const item of [
    "SCOPE_RESULT: ${{ needs.change-scope.result }}",
    "REGRESSION_RESULT: ${{ needs.test-shard.result }}",
    "AUDIT_RESULT: ${{ needs.audit-chain-protection.result }}",
    "VALIDATION_RESULT: ${{ needs.validation.result }}",
  ]) assert.ok(gate.includes(item), "required aggregate missing input " + item);
  assert.ok(gate.includes('if [ "$SCOPE_RESULT" != "success" ]; then'));
  assert.ok(gate.includes('if [ "$DOCS_ONLY" = "true" ]; then'));
  assert.ok(gate.includes('if [ "$REGRESSION_RESULT" != "skipped" ] || [ "$AUDIT_RESULT" != "skipped" ] || [ "$VALIDATION_RESULT" != "skipped" ]; then'),
    "docs-only exception must confirm every heavy job was actually skipped");
  assert.ok(gate.includes('for result in "$REGRESSION_RESULT" "$AUDIT_RESULT" "$VALIDATION_RESULT"; do'));
  assert.ok(gate.includes('if [ "$result" != "success" ]; then'),
    "a failed, cancelled or unexpected skipped job must fail the aggregate");
  assert.ok(gate.includes("exit 1"), "required status must fail with a nonzero exit");
});

test("sharded CI checkout and Node setup remain immutable-action pinned", () => {
  const source = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.doesNotMatch(source, /uses: actions\/(?:checkout|setup-node)@v\d+\b/);
  assert.match(source, /uses: actions\/checkout@[a-f0-9]{40}/);
  assert.match(source, /uses: actions\/setup-node@[a-f0-9]{40}/);
});


test("machine collectors opt into TAP while human jobs retain spec; invalid reporters fail closed", () => {
  const files = ["tests/fictional-a.test.ts", "tests/fictional-b.test.mjs"];
  assert.deepEqual(regressionTestArguments(files), ["--test", "--test-concurrency=1", "--test-reporter=spec", ...files]);
  assert.deepEqual(regressionTestArguments(files, "tap"), ["--test", "--test-concurrency=1", "--test-reporter=tap", ...files]);
  for (const reporter of ["", "json", "spec --test-only", null]) assert.throws(() => regressionTestArguments(files, reporter), /INVALID_REGRESSION_REPORTER/);
});
