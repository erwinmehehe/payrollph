import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import pg from "pg";
import { assertIsolatedMigrationTarget } from "../scripts/lib/isolated-migration-target.mjs";

const migrationPath = "drizzle/0124_attendance_exception_forward_repair.sql";
const migrationSql = readFileSync(migrationPath, "utf8");
const catalogSql = readFileSync("docs/sql/issue-1015-attendance-exception-catalog-preflight.sql", "utf8");

// The migration source may be reviewed on any machine, but EXECUTION only
// occurs on the disposable localhost GitHub PG16 fixture, NEVER on Neon.
const isolated = process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true" &&
  (() => {
    try {
      const url = new URL(process.env.DATABASE_URL);
      return ["postgresql:", "postgres:"].includes(url.protocol)
        && ["localhost", "127.0.0.1"].includes(url.hostname)
        && url.port === "5432" && url.pathname === "/app_db"
        && url.username === "postgres" && !url.search && !url.hash;
    } catch { return false; }
  })();

test("#1015 candidate is additive, creates missing final schema, and has explicit fail-closed guards", () => {
  const tokens = migrationSql.replace(/--[^\n]*/g, "");
  assert.match(tokens, /^DO \$issue1015_attendance_preflight\$/);
  assert.match(tokens, /CREATE TABLE public\.attendance_exception_events\s*\(/);
  assert.match(tokens, /ISSUE1015_EXISTING_ATTENDANCE_RELATION_REQUIRES_MANUAL_REVIEW/);
  assert.match(tokens, /ISSUE1015_PARENT_INTEGER_PK_MISSING_OR_DRIFTED/);
  assert.doesNotMatch(tokens, /\bIF NOT EXISTS\b|\bDROP\b|\bTRUNCATE\b|\bUPDATE\b|\bDELETE\b|\bINSERT\b|\bALTER TABLE\b/i);
  assert.doesNotMatch(tokens, /\b(?:FROM|JOIN)\s+(?:public\.)?(?:employees|users|time_punches|payroll_runs|payroll_entries|attendance_exception_events)\b/i,
    "migration cannot query application rows to infer or backfill historical data");
  assert.doesNotMatch(tokens, /\b(?:BEGIN|COMMIT|ROLLBACK)\b/i,
    "protected runner, not migration SQL, owns the release transaction");
  for (const expected of [
    "CREATE UNIQUE INDEX attendance_exception_events_fingerprint_unique",
    "CREATE INDEX attendance_exception_events_open_idx",
    "CREATE INDEX attendance_exception_events_employee_idx",
    "CREATE INDEX attendance_exception_events_owner_idx",
    "CREATE INDEX attendance_exception_events_sla_idx",
    "attendance_exception_events_severity_check",
    "attendance_exception_events_status_check",
    "ON DELETE CASCADE", "ON DELETE SET NULL",
  ]) {
    assert.ok(tokens.includes(expected), "missing expected final-state contract " + expected);
  }
});

test("#1015 migration requires complete isolated PG, detects prerequisite drift and creates exactly 36 catalog-approved objects", {
  skip: !isolated, timeout: 90000,
}, async () => {
  const baseUrl = assertIsolatedMigrationTarget({
    ...process.env, MIGRATION_REHEARSAL_MODE: "isolated-ci-only",
  });
  const database = "issue1015_" + randomUUID().replaceAll("-", "").slice(0, 16);
  const admin = new pg.Client({ connectionString: baseUrl, connectionTimeoutMillis: 5000 });
  let scratch, created = false, inTransaction = false;
  await admin.connect();
  try {
    // CREATE/DROP only a NEW, randomly named disposable CI database. No
    // modifications to app_db or any external branch. The scratch DB is deleted.
    await admin.query('CREATE DATABASE "' + database + '"');
    created = true;
    const scratchUrl = new URL(baseUrl);
    scratchUrl.pathname = "/" + database;
    scratch = new pg.Client({ connectionString: scratchUrl.toString(), connectionTimeoutMillis: 5000 });
    await scratch.connect();

    for (const name of ["organizations", "employees", "users"]) {
      await scratch.query('CREATE TABLE public."' + name + '" (id integer PRIMARY KEY)');
    }

    // An absent parent must fail *before* creating any target table/sequence.
    await assert.rejects(
      () => scratch.query(migrationSql),
      (error) => error.code === "P0001" && /ISSUE1015_PARENT_INTEGER_PK_MISSING_OR_DRIFTED/.test(error.message),
    );
    assert.equal((await scratch.query(
      "SELECT pg_catalog.to_regclass('public.attendance_exception_events') AS relation",
    )).rows[0].relation, null);

    // A present but incorrectly typed parent PK must also fail without writes.
    await scratch.query("CREATE TABLE public.time_punches (id uuid PRIMARY KEY)");
    await assert.rejects(() => scratch.query(migrationSql), (error) =>
      error.code === "P0001" && /ISSUE1015_PARENT_INTEGER_PK_MISSING_OR_DRIFTED/.test(error.message));
    await scratch.query("DROP TABLE public.time_punches");
    await scratch.query("CREATE TABLE public.time_punches (id integer PRIMARY KEY)");

    // Execute the ACTUAL proposed SQL inside a rollback-only transaction.
    await scratch.query("BEGIN");
    inTransaction = true;
    await scratch.query(migrationSql);
    const results = (await scratch.query(catalogSql)).rows;
    assert.equal(results.length, 36, "must match all 36 audited attendance schema objects");
    assert.deepEqual(results.filter((row) => row.status !== "PASS"), [],
      "new table, 23 columns, 5 indexes, 5 FKs and 2 CHECKs must match source contract");
    assert.ok(results.every((row) => row.evidence_scope.endsWith("NOT_MIGRATION_RECEIPT_OR_RELEASE_APPROVAL")));

    // Re-running the migration is a HARD STOP, not silent IF NOT EXISTS.
    await scratch.query("SAVEPOINT repeat_guard");
    await assert.rejects(() => scratch.query(migrationSql), (error) =>
      error.code === "P0001" &&
      /ISSUE1015_EXISTING_ATTENDANCE_RELATION_REQUIRES_MANUAL_REVIEW/.test(error.message));
    await scratch.query("ROLLBACK TO SAVEPOINT repeat_guard");
    await scratch.query("RELEASE SAVEPOINT repeat_guard");

    // Synthetic-only rows prove constraints, defaults and uniqueness.
    for (const name of ["organizations", "employees", "users", "time_punches"]) {
      await scratch.query('INSERT INTO public."' + name + '"(id) VALUES (1), (2)');
    }
    const baseInsert = [
      "INSERT INTO public.attendance_exception_events",
      "(organization_id,employee_id,work_date,exception_kind,severity,message,fingerprint_sha256)",
      "VALUES ($1,$2,'2026-10-15','missing_punch',$3,'Fictional CI-only exception',$4)",
      "RETURNING id,status,created_at,first_detected_at,updated_at",
    ].join(" ");
    const alpha = (await scratch.query(baseInsert, [1, 1, "blocker", "a".repeat(64)])).rows[0];
    assert.equal(alpha.status, "open");
    assert.ok(alpha.id > 0 && alpha.created_at && alpha.first_detected_at && alpha.updated_at);
    const beta = (await scratch.query(baseInsert, [2, 2, "warning", "a".repeat(64)])).rows[0];
    assert.ok(beta.id > alpha.id, "same fingerprint may exist in another fictional tenant");

    await scratch.query("SAVEPOINT same_tenant_duplicate");
    await assert.rejects(() => scratch.query(baseInsert, [1, 1, "blocker", "a".repeat(64)]),
      (error) => error.code === "23505", "same tenant/employee/date/fingerprint must be unique");
    await scratch.query("ROLLBACK TO SAVEPOINT same_tenant_duplicate");

    await scratch.query("SAVEPOINT invalid_severity");
    await assert.rejects(() => scratch.query(baseInsert, [1, 1, "invalid", "b".repeat(64)]),
      (error) => error.code === "23514", "invalid severity must be rejected");
    await scratch.query("ROLLBACK TO SAVEPOINT invalid_severity");

    await scratch.query("SAVEPOINT missing_owner");
    await assert.rejects(() => scratch.query(
      "UPDATE public.attendance_exception_events SET owner_user_id = 999 WHERE id = $1", [alpha.id],
    ), (error) => error.code === "23503", "owner must reference existing fictional user");
    await scratch.query("ROLLBACK TO SAVEPOINT missing_owner");

    const currentRows = (await scratch.query(
      "SELECT organization_id,status FROM public.attendance_exception_events ORDER BY organization_id",
    )).rows;
    assert.deepEqual(currentRows, [
      { organization_id: 1, status: "open" }, { organization_id: 2, status: "open" },
    ]);

    await scratch.query("ROLLBACK");
    inTransaction = false;
    assert.equal((await scratch.query(
      "SELECT pg_catalog.to_regclass('public.attendance_exception_events') AS relation",
    )).rows[0].relation, null, "candidate migration must be completely rolled back");
  } finally {
    if (inTransaction && scratch) {
      try { await scratch.query("ROLLBACK"); } catch { /* best-effort isolation cleanup */ }
    }
    if (scratch) {
      try { await scratch.end(); } catch { /* disconnected scratch server */ }
    }
    if (created) {
      try { await admin.query('DROP DATABASE "' + database + '"'); }
      catch (error) {
        // Cleanup failure is release evidence failure, never silently accept.
        throw new Error("ISSUE1015_DISPOSABLE_DATABASE_CLEANUP_FAILED", { cause: error });
      }
    }
    await admin.end();
  }
});
