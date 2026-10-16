import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { classifyStrictDbPush } from "../scripts/strict-db-push.mjs";

test("#1019 first push accepts only an affirmative applied result", () => {
  assert.equal(classifyStrictDbPush(0, "[✓] Changes applied", ""), "applied");
  assert.throws(() => classifyStrictDbPush(0, "", ""), /STRICT_DB_PUSH_UNPROVEN_RESULT/);
  assert.throws(() => classifyStrictDbPush(0, "Pulling schema...", ""), /STRICT_DB_PUSH_UNPROVEN_RESULT/);
  assert.throws(() => classifyStrictDbPush(1, "Changes applied", ""), /STRICT_DB_PUSH_NONZERO_EXIT/);
});

test("#1019 real second push must be a strict, DDL-free no-op", () => {
  assert.equal(classifyStrictDbPush(0, "\u001b[32m[✓] No changes detected\u001b[0m", ""), "no-op");
  assert.throws(() => classifyStrictDbPush(0, "No changes detected\nALTER TABLE documents DROP CONSTRAINT x;", ""),
    /STRICT_DB_PUSH_UNPROVEN_RESULT/);
  assert.throws(() => classifyStrictDbPush(0, "No changes detected\nCREATE INDEX ix ON t(x)", ""),
    /STRICT_DB_PUSH_UNPROVEN_RESULT/);
  assert.throws(() => classifyStrictDbPush(0, "No changes detected\nChanges applied", ""),
    /STRICT_DB_PUSH_UNPROVEN_RESULT/);
});

test("#1019 rejects PostgreSQL SQLSTATE 2BP01 even when Drizzle returns exit zero", () => {
  const sql = 'ALTER TABLE "documents" DROP CONSTRAINT "documents_org_employee_id_hr_cases_unique";';
  const error = "error: cannot drop constraint because other objects depend on it\nSQLSTATE 2BP01\n" + sql;
  assert.throws(() => classifyStrictDbPush(0, error, ""), /STRICT_DB_PUSH_REPORTED_ERROR/);
  assert.throws(() => classifyStrictDbPush(0, "Changes applied", error), /STRICT_DB_PUSH_REPORTED_ERROR/);
  assert.throws(() => classifyStrictDbPush(0, "No changes detected", "ERROR: 2BP01"), /STRICT_DB_PUSH_REPORTED_ERROR/);
  assert.throws(() => classifyStrictDbPush(0, "Changes applied", "Error: Interactive prompts require a TTY terminal"),
    /STRICT_DB_PUSH_REPORTED_ERROR/);
  assert.throws(() => classifyStrictDbPush(0, "Changes applied", "Fatal: unexpected error"),
    /STRICT_DB_PUSH_REPORTED_ERROR/);
});

test("#1019 local guard rejects remote URLs before reading driver output", () => {
  const remote = "postgresql://private:do-not-log-this-password@prod.neon.tech/neondb";
  const env = { ...process.env, DATABASE_URL: remote };
  const run = spawnSync(process.execPath, ["scripts/strict-db-push.mjs"], {
    cwd: process.cwd(), env, encoding: "utf8", timeout: 15_000,
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /DB_PUSH_/);
  assert.ok(!run.stdout.includes("neon.tech"));
  assert.ok(!run.stderr.includes("do-not-log-this-password"));
});

test("#1019 normal npm db:push cannot invoke unguarded drizzle-kit", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(pkg.scripts["db:push"], "node scripts/strict-db-push.mjs");
  const code = readFileSync("scripts/strict-db-push.mjs", "utf8");
  assert.match(code, /assertIsolatedDbPushTarget\(env\.DATABASE_URL, env\)/);
  assert.match(code, /classifyStrictDbPush\(code, stdout, stderr\)/);
  assert.match(code, /\[BIN, "push", \.\.\.\(verbose/);
  assert.match(code, /env\.ISSUE_1019_VERBOSE === "true"/);
  assert.match(code, /env\.GITHUB_ACTIONS === "true"/);
  assert.doesNotMatch(code, /shell:\s*true|--force|--accept-data-loss|DROP\s+SCHEMA/);
});
