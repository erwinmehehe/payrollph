import assert from "node:assert/strict";
import test from "node:test";
import { assertIsolatedDbPushTarget } from "../scripts/lib/isolated-db-push-target.mjs";

const local = "postgresql://postgres:postgres@127.0.0.1:5432/app_db";
const ci = { CI: "true", GITHUB_ACTIONS: "true" };

test("allows only a local disposable PostgreSQL schema push under GitHub CI", () => {
  assert.deepEqual(assertIsolatedDbPushTarget(local, ci), {
    hostname: "127.0.0.1", databaseName: "app_db", isolated: true,
  });
  assert.equal(assertIsolatedDbPushTarget(
    "postgresql://developer:pw@localhost:5432/isolated_development", {},
  ).databaseName, "isolated_development");
});

test("cannot point db:push to Neon, a remote host, a renamed hostname or a system database", () => {
  for (const url of [
    "postgresql://u:p@ep-cool-hat-b7e7gpoo.c-13.us-east-1.aws.neon.tech/neondb",
    "postgresql://u:p@ep-cool-hat-b7e7gpoo-pooler.c-13.us-east-1.aws.neon.tech/neondb",
    "postgresql://u:p@localhost.evil.invalid:5432/app_db",
    "postgresql://u:p@192.168.1.2:5432/app_db",
    "postgresql://u:p@postgres:5432/app_db",
    "postgresql://u:p@127.0.0.1:5433/app_db",
    "postgresql://u:p@127.0.0.1:5432/neondb",
    "postgresql://u:p@127.0.0.1:5432/postgres",
    "postgresql://u:p@127.0.0.1:5432/app_db?host=remote",
    "https://u:p@127.0.0.1:5432/app_db",
    "", "not-a-url",
  ]) {
    assert.throws(() => assertIsolatedDbPushTarget(url, ci),
      /^Error: DB_PUSH_/);
  }
});

test("a CI job cannot redirect push to developer or unsandboxed database", () => {
  assert.throws(() => assertIsolatedDbPushTarget(
    "postgresql://u:p@127.0.0.1:5432/local_development", ci,
  ), /DB_PUSH_CI_MUST_USE_SYNTHETIC_LOOPBACK_APP_DB/);
  assert.throws(() => assertIsolatedDbPushTarget(local,
    { GITHUB_ACTIONS: "true" }), /DB_PUSH_CI_MUST_USE_SYNTHETIC_LOOPBACK_APP_DB/);
  assert.throws(() => assertIsolatedDbPushTarget(local,
    { CI: "true" }), /DB_PUSH_CI_MUST_USE_SYNTHETIC_LOOPBACK_APP_DB/);
});

test("the direct Drizzle config path also guards push without disabling generate", async () => {
  const { readFileSync } = await import("node:fs");
  const config = readFileSync(new URL("../drizzle.config.ts", import.meta.url), "utf8");
  assert.match(config, /import \\{ assertIsolatedDbPushTarget \\}/);
  assert.match(config, /process\\.argv\\.slice\\(1\\)/);
  assert.match(config, /arg === "push"/);
  assert.doesNotMatch(config, /process\\.exit\\(/);
});
