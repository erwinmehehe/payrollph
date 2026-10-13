import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { regressionFiles, selectRegressionShard } from "../scripts/run-sharded-tests.mjs";

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

test("CI keeps the required check job conditional on all shard results", () => {
  const source = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(source, /test-shard:\s*\n/);
  assert.match(source, /check:\s*\n\s*needs: test-shard/);
  assert.match(source, /run: node scripts\/run-sharded-tests\.mjs/);
  assert.match(source, /postgres:\s*\n\s*image: postgres:16/);
});

test("sharded CI checkout and Node setup remain immutable-action pinned", () => {
  const source = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.doesNotMatch(source, /uses: actions\/(?:checkout|setup-node)@v\d+\b/);
  assert.match(source, /uses: actions\/checkout@[a-f0-9]{40}/);
  assert.match(source, /uses: actions\/setup-node@[a-f0-9]{40}/);
});
