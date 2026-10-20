import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

test("the default CI regression runner includes both .test.ts and .test.mjs files", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };
  const command = pkg.scripts.test;
  assert.match(command, /tsx --test --test-concurrency=1 tests\/\*\.test\.ts/);
  assert.match(command, /node --test --test-concurrency=1 tests\/\*\.test\.mjs/);

  const files = readdirSync("tests");
  const ts = files.filter((name) => name.endsWith(".test.ts"));
  const mjs = files.filter((name) => name.endsWith(".test.mjs"));
  assert.ok(ts.length > 0, "TypeScript tests must exist");
  assert.ok(mjs.length > 0, "Operational JavaScript tests must exist");
  // Each CI shard uses an independent disposable PostgreSQL service. The
  // required check job cannot succeed unless every matrix shard passes.
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(ci, /needs: \[test-shard, audit-chain-protection\]/);
  assert.match(ci, /needs\.audit-chain-protection\.result != 'success'/);
  assert.match(ci, /shard: \[0, 1, 2, 3\]/);
  assert.match(ci, /node scripts\/run-sharded-tests\.mjs/);
  assert.match(ci, /DATABASE_URL: postgresql:\/\/postgres/);
});
