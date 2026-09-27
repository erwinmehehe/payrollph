import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("public homepage renders without DATABASE_URL", () => {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.DEMO_MODE;

  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--eval",
      'const m = await import("./src/components/public-homepage.tsx"); const tree = await m.PublicHomepage(); if (!tree) process.exit(9);',
    ],
    { cwd: process.cwd(), env, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
});
