import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import pg from "pg";
import { assertIsolatedMigrationTarget } from "../scripts/lib/isolated-migration-target.mjs";

// Issue #1054: source-only candidate, executed ONLY against disposable CI PG.
// All DDL is inside one transaction, which is rolled back on success or error.
const targetTables = [
  "employee_availability_rules", "open_shifts", "open_shift_claims",
];
const source = readFileSync(
  new URL("../drizzle/0125_wfm_availability_open_shifts_forward_repair.sql", import.meta.url),
  "utf8",
);
const sha256 = createHash("sha256").update(source).digest("hex");

async function snapshot(db) {
  const [columns, indexes, foreignKeys] = await Promise.all([
    db.query(
      "SELECT table_name,column_name,data_type,udt_name,character_maximum_length," +
      "is_nullable,column_default FROM information_schema.columns " +
      "WHERE table_schema='public' AND table_name = ANY($1::text[]) " +
      "ORDER BY table_name,ordinal_position", [targetTables],
    ),
    db.query(
      "SELECT tablename AS table_name,indexname,indexdef FROM pg_catalog.pg_indexes " +
      "WHERE schemaname='public' AND tablename = ANY($1::text[]) " +
      "ORDER BY tablename,indexname", [targetTables],
    ),
    db.query(
      "SELECT t.relname AS table_name,k.contype,pg_catalog.pg_get_constraintdef(k.oid) AS definition " +
      "FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class t ON t.oid=k.conrelid " +
      "JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace " +
      "WHERE n.nspname='public' AND t.relname = ANY($1::text[]) " +
      "ORDER BY t.relname,k.contype,pg_catalog.pg_get_constraintdef(k.oid)", [targetTables],
    ),
  ]);
  return {
    columns: columns.rows, indexes: indexes.rows, constraints: foreignKeys.rows,
  };
}

async function guardedFailure(db, code, message) {
  await db.query("SAVEPOINT issue1054_guard_attempt");
  try {
    await assert.rejects(() => db.query(source), error =>
      error?.code === code && error?.message.includes(message),
    );
  } finally {
    await db.query("ROLLBACK TO SAVEPOINT issue1054_guard_attempt");
    await db.query("RELEASE SAVEPOINT issue1054_guard_attempt");
  }
}

test("#1054: exact SQL matches current Drizzle catalog, rejects unsafe replay, and rolls back", {
  // Full regression shards run with a shared CI flag but no special rehearsal mode.
  // Never connect or fail their entire inventory for a workflow-only PG contract.
  skip: process.env.ISSUE_1054_REHEARSAL !== "isolated-ci-only",
  timeout: 120000,
}, async () => {
  assert.equal(process.env.ISSUE_1054_REHEARSAL, "isolated-ci-only");
  const url = assertIsolatedMigrationTarget(process.env);
  assert.match(sha256, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(source, /CREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?staffing_requirement_unique/i);
  assert.doesNotMatch(source, /ALTER\s+TABLE\s+["']?staffing_requirements/i);
  assert.doesNotMatch(source, /\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|TRUNCATE\s+TABLE)\b/i);
  const db = new pg.Client({
    connectionString: url, connectionTimeoutMillis: 5000, query_timeout: 90000,
  });
  let open = false;
  await db.connect();
  try {
    const identity = (await db.query(
      "SELECT current_database() AS db,current_user AS role," +
      "current_setting('server_version_num')::integer AS version",
    )).rows[0];
    const major = Number(process.env.WFM_REHEARSAL_PG_MAJOR);
    assert.ok([16, 18].includes(major) &&
      identity.db === "app_db" && identity.role === "postgres" &&
      identity.version >= major * 10000 && identity.version < (major + 1) * 10000,
    "only supported disposable PostgreSQL versions");
    const empty = (await db.query(
      "SELECT (SELECT count(*)::int FROM organizations) AS tenants," +
      "(SELECT count(*)::int FROM employees) AS employees," +
      "(SELECT count(*)::int FROM payroll_runs) AS payroll_runs," +
      "(SELECT count(*)::int FROM payroll_entries) AS payroll_entries",
    )).rows[0];
    assert.deepEqual(empty, { tenants: 0, employees: 0, payroll_runs: 0, payroll_entries: 0 },
      "disposable schema must contain no existing employer or payroll data");

    const before = await snapshot(db);
    assert.ok(before.columns.length > 40 && before.indexes.length >= 10 &&
      before.constraints.length >= 13, "fresh Drizzle schema must have complete target tables");

    await db.query("BEGIN");
    open = true;
    await db.query("SET LOCAL statement_timeout = '90000ms'");
    await db.query("SET LOCAL lock_timeout = '3000ms'");
    for (const table of ["open_shift_claims", "open_shifts", "employee_availability_rules"]) {
      await db.query('DROP TABLE public."' + table + '"');
    }
    assert.equal((await snapshot(db)).columns.length, 0);

    // Negative gates must fail before installing even the first target table.
    await db.query("SAVEPOINT missing_role_index");
    await db.query('DROP INDEX public."staffing_requirement_role_unique"');
    await guardedFailure(db, "P0001", "ISSUE1054_STAFFING_ROLE_INDEX_NOT_FOUND");
    await db.query("ROLLBACK TO SAVEPOINT missing_role_index");
    await db.query("RELEASE SAVEPOINT missing_role_index");
    assert.equal((await snapshot(db)).columns.length, 0);

    await db.query("SAVEPOINT wrong_role_index");
    await db.query('DROP INDEX public."staffing_requirement_role_unique"');
    await db.query('CREATE UNIQUE INDEX "staffing_requirement_role_unique" ON "staffing_requirements" ("organization_id","worksite_id","work_date","shift_definition_id")');
    await guardedFailure(db, "P0001", "ISSUE1054_STAFFING_ROLE_INDEX_NOT_FOUND");
    await db.query("ROLLBACK TO SAVEPOINT wrong_role_index");
    await db.query("RELEASE SAVEPOINT wrong_role_index");
    assert.equal((await snapshot(db)).columns.length, 0);

    await db.query("SAVEPOINT legacy_staffing_index");
    await db.query('CREATE UNIQUE INDEX "staffing_requirement_unique" ON "staffing_requirements" ("organization_id","worksite_id","work_date","shift_definition_id")');
    await guardedFailure(db, "P0001", "ISSUE1054_LEGACY_STAFFING_UNIQUENESS_PRESENT");
    await db.query("ROLLBACK TO SAVEPOINT legacy_staffing_index");
    await db.query("RELEASE SAVEPOINT legacy_staffing_index");
    assert.equal((await snapshot(db)).columns.length, 0);

    await db.query("SAVEPOINT partial_install");
    await db.query('CREATE TABLE "employee_availability_rules" ("id" integer)');
    await guardedFailure(db, "P0001", "ISSUE1054_PARTIAL_OR_EXISTING_SCHEMA_REQUIRES_RECONCILIATION");
    await db.query("ROLLBACK TO SAVEPOINT partial_install");
    await db.query("RELEASE SAVEPOINT partial_install");

    await db.query(source);
    const after = await snapshot(db);
    assert.deepEqual(after, before,
      "forward-only 0125 must reproduce exactly the existing current Drizzle column, index and FK contracts");
    await guardedFailure(db, "P0001", "ISSUE1054_PARTIAL_OR_EXISTING_SCHEMA_REQUIRES_RECONCILIATION");
    assert.deepEqual(await snapshot(db), after,
      "replay must fail closed with no schema change");

    // Synthetic failure injection proves the encompassing transaction can undo DDL.
    await db.query("SAVEPOINT injected_error");
    await assert.rejects(
      () => db.query('ALTER TABLE "open_shift_claims" ADD CONSTRAINT missing_fk ' +
        'FOREIGN KEY ("employee_id") REFERENCES "issue1054_absent_table"("id")'),
      error => error?.code === "42P01",
    );
    await db.query("ROLLBACK TO SAVEPOINT injected_error");
    await db.query("RELEASE SAVEPOINT injected_error");
    await db.query("ROLLBACK");
    open = false;

    assert.deepEqual(await snapshot(db), before, "rollback must restore initial catalog");
    assert.deepEqual((await db.query(
      "SELECT (SELECT count(*)::int FROM organizations) AS tenants," +
      "(SELECT count(*)::int FROM employees) AS employees," +
      "(SELECT count(*)::int FROM payroll_runs) AS payroll_runs," +
      "(SELECT count(*)::int FROM payroll_entries) AS payroll_entries",
    )).rows[0], empty, "rehearsal must not alter any employee or payroll counts");
    console.log(JSON.stringify({
      issue: 1054, mode: "isolated-ci-rollback-only", postgresMajor: major,
      migrationSha256: sha256, parity: "columns/indexes/FKs matched",
      guardCases: ["missing role index", "wrong role index", "legacy index", "partial schema", "replay"],
      rollbackVerified: true, productionConnected: false, appliedReceipt: false,
      tenantAndRoleAcceptance: "NOT_RUN_EXTERNAL",
    }));
  } finally {
    if (open) await db.query("ROLLBACK").catch(() => {});
    await db.end().catch(() => {});
  }
});
