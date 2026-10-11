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
  // The regression entrypoint is used by .github/workflows/ci.yml, ensuring
  // both types run on the same exact PR head.
  assert.match(readFileSync(".github/workflows/ci.yml", "utf8"), /npm test/);
});
