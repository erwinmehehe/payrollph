import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

function runWithoutDatabase(code: string) {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  return spawnSync(process.execPath, ["--import", "tsx", "--eval", code], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });
}

test("database module can be imported without DATABASE_URL during a build", () => {
  const result = runWithoutDatabase('await import("./src/db/index.ts");');
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("database access still fails clearly at runtime when DATABASE_URL is missing", () => {
  const result = runWithoutDatabase(
    'const { db } = await import("./src/db/index.ts"); try { db.select(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(23); }',
  );
  assert.equal(result.status, 23, result.stderr || result.stdout);
  assert.match(result.stderr, /DATABASE_URL is required/);
});
