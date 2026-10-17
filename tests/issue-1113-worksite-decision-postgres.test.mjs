import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import pg from "pg";
import { assertIsolatedMigrationTarget } from "../scripts/lib/isolated-migration-target.mjs";

// #1113: disposable, fresh-schema PostgreSQL 16/18 only. The source is an
// unnumbered candidate; no historical ledger, Neon or production connection.
const source = readFileSync(
  new URL("../docs/sql/issue-1113-worksite-decision-forward-candidate.sql", import.meta.url),
  "utf8",
);
const sourceSha256 = createHash("sha256").update(source).digest("hex");
const target = "employee_worksite_assignments";

async function catalog(db) {
  const columns = await db.query(
    "SELECT a.attname AS name, pg_catalog.format_type(a.atttypid,a.atttypmod) AS type, " +
      "a.attnotnull AS not_null, pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS default_value " +
      "FROM pg_catalog.pg_attribute a " +
      "LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum " +
      "WHERE a.attrelid='public.employee_worksite_assignments'::pg_catalog.regclass " +
      "AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attname",
  );
  const constraints = await db.query(
    "SELECT contype,pg_catalog.pg_get_constraintdef(oid) AS definition " +
      "FROM pg_catalog.pg_constraint " +
      "WHERE conrelid='public.employee_worksite_assignments'::pg_catalog.regclass " +
      "ORDER BY contype,pg_catalog.pg_get_constraintdef(oid)",
  );
  const indexes = await db.query(
    "SELECT indexname,indexdef FROM pg_catalog.pg_indexes " +
      "WHERE schemaname='public' AND tablename=$1 ORDER BY indexname", [target],
  );
  const rowCount = (await db.query(
    "SELECT count(*)::integer AS count FROM public.employee_worksite_assignments",
  )).rows[0].count;
  return { columns: columns.rows, constraints: constraints.rows, indexes: indexes.rows, rowCount };
}

async function expectGuard(db, state, marker) {
  await db.query("SAVEPOINT issue1113_failure");
  try {
    await assert.rejects(
      () => db.query(source),
      error => error?.code === state && error?.message.includes(marker),
      marker,
    );
  } finally {
    await db.query("ROLLBACK TO SAVEPOINT issue1113_failure");
    await db.query("RELEASE SAVEPOINT issue1113_failure");
  }
}

test("#1113: guarded missing worksite decision forward candidate, rollback and lock denial", {
  skip: process.env.ISSUE_1113_REHEARSAL !== "isolated-ci-only",
  timeout: 120000,
}, async () => {
  assert.equal(process.env.ISSUE_1113_REHEARSAL, "isolated-ci-only");
  const url = assertIsolatedMigrationTarget(process.env);
  const sqlWithoutComments = source.split("\n").filter(line => !line.trimStart().startsWith("--")).join("\n");
  assert.match(sourceSha256, /^[0-9a-f]{64}$/);
  assert.match(source, /LOCK TABLE public\.employee_worksite_assignments IN ACCESS EXCLUSIVE MODE NOWAIT/);
  assert.match(source, /ISSUE1113_DECISION_ALREADY_PRESENT_REQUIRES_REVIEW/);
  assert.match(source, /ISSUE1113_PREEXISTING_TENANT_FOREIGN_KEYS_DRIFTED/);
  assert.doesNotMatch(sqlWithoutComments, /\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|GRANT|COMMIT|CREATE\s+TABLE)\b/i);

  const db = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000, query_timeout: 90000 });
  let inTransaction = false;
  await db.connect();
  try {
    const identity = (await db.query(
      "SELECT current_database() AS db,current_user AS role," +
      "current_setting('server_version_num')::integer AS version",
    )).rows[0];
    const major = Number(process.env.ISSUE_1113_PG_MAJOR);
    assert.ok([16, 18].includes(major) && identity.db === "app_db" &&
      identity.role === "postgres" && identity.version >= major * 10000 &&
      identity.version < (major + 1) * 10000, "only synthetic PG16/PG18");
    const initialCounts = (await db.query(
      "SELECT (SELECT count(*)::integer FROM organizations) AS organizations," +
      "(SELECT count(*)::integer FROM employees) AS employees," +
      "(SELECT count(*)::integer FROM payroll_runs) AS payroll_runs," +
      "(SELECT count(*)::integer FROM payroll_entries) AS payroll_entries",
    )).rows[0];
    assert.deepEqual(initialCounts,
      { organizations: 0, employees: 0, payroll_runs: 0, payroll_entries: 0 },
      "never rehearse on an employer or shared DB");

    const original = await catalog(db);
    const originalDecision = original.columns.find(column => column.name === "decision");
    assert.deepEqual(
      { type: originalDecision?.type, not_null: originalDecision?.not_null,
        default_value: originalDecision?.default_value },
      { type: "character varying(8)", not_null: true,
        default_value: "'allow'::character varying" },
      "fresh current Drizzle schema is the reference",
    );
    await db.query("BEGIN");
    inTransaction = true;
    await db.query("SET LOCAL lock_timeout = '3000ms'");
    await db.query("SET LOCAL statement_timeout = '90000ms'");

    // Source-current table already contains the column. A journal-less
    // application must fail rather than silently claim a migration receipt.
    await expectGuard(db, "P0001", "ISSUE1113_DECISION_ALREADY_PRESENT_REQUIRES_REVIEW");

    // Fictional rows prove existing authorizations retain identity and
    // acquire only the intended default. All insertions are rolled back.
    const organizationId = (await db.query(
      "INSERT INTO public.organizations(name,legal_name) VALUES " +
      "('issue1113-fictitious','Issue 1113 Disposable Fixture') RETURNING id",
    )).rows[0].id;
    const employeeId = (await db.query(
      "INSERT INTO public.employees(organization_id,employee_no,first_name,last_name," +
      "title,avatar_initials,basic_rate,start_date) VALUES " +
      "($1,'QA-1113','Test','Worker','Fictional','TW',100,'2026-01-01') RETURNING id",
      [organizationId],
    )).rows[0].id;
    const worksiteId = (await db.query(
      "INSERT INTO public.worksites(organization_id,code,name) " +
      "VALUES ($1,'QA-WS','Synthetic worksite') RETURNING id",
      [organizationId],
    )).rows[0].id;
    const assignmentId = (await db.query(
      "INSERT INTO public.employee_worksite_assignments " +
      "(organization_id,employee_id,worksite_id,effective_from,reason,created_by) " +
      "VALUES ($1,$2,$3,'2026-01-01','Synthetic fixture','Issue1113 CI') RETURNING id",
      [organizationId, employeeId, worksiteId],
    )).rows[0].id;

    await db.query("ALTER TABLE public.employee_worksite_assignments DROP COLUMN decision");
    assert.ok(!(await catalog(db)).columns.some(x => x.name === "decision"),
      "reproduce the historical missing-column schema");

    await db.query("SAVEPOINT wrong_existing_column");
    await db.query("ALTER TABLE public.employee_worksite_assignments ADD COLUMN decision integer");
    await expectGuard(db, "P0001", "ISSUE1113_DECISION_ALREADY_PRESENT_REQUIRES_REVIEW");
    await db.query("ROLLBACK TO SAVEPOINT wrong_existing_column");
    await db.query("RELEASE SAVEPOINT wrong_existing_column");

    await db.query("SAVEPOINT wrong_existing_type");
    await db.query("ALTER TABLE public.employee_worksite_assignments ALTER COLUMN created_by TYPE varchar(80)");
    await expectGuard(db, "P0001", "ISSUE1113_PREEXISTING_COLUMNS_DRIFTED");
    await db.query("ROLLBACK TO SAVEPOINT wrong_existing_type");
    await db.query("RELEASE SAVEPOINT wrong_existing_type");

    const fkName = (await db.query(
      "SELECT fk.conname FROM pg_catalog.pg_constraint fk " +
      "JOIN pg_catalog.pg_attribute a ON a.attrelid=fk.conrelid " +
      "WHERE fk.conrelid='public.employee_worksite_assignments'::pg_catalog.regclass " +
      "AND fk.contype='f' AND a.attname='worksite_id' " +
      "AND fk.conkey=ARRAY[a.attnum]::smallint[]",
    )).rows[0]?.conname;
    assert.match(fkName ?? "", /^[a-z0-9_]+$/);
    await db.query("SAVEPOINT missing_worksite_fk");
    await db.query('ALTER TABLE public.employee_worksite_assignments DROP CONSTRAINT "' + fkName + '"');
    await expectGuard(db, "P0001", "ISSUE1113_PREEXISTING_TENANT_FOREIGN_KEYS_DRIFTED");
    await db.query("ROLLBACK TO SAVEPOINT missing_worksite_fk");
    await db.query("RELEASE SAVEPOINT missing_worksite_fk");

    await db.query(source);
    const restored = await catalog(db);
    assert.deepEqual(restored.columns, original.columns,
      "candidate must restore the exact Drizzle column types, default and nullability");
    assert.deepEqual(restored.constraints, original.constraints,
      "candidate must not change any existing PK/FK or other constraint");
    assert.deepEqual(restored.indexes, original.indexes,
      "candidate must not drop/change existing indexes");
    assert.equal(restored.rowCount, 1, "preexisting assignment survives");
    const kept = (await db.query(
      "SELECT id,organization_id,employee_id,worksite_id,decision,effective_from::text AS effective_from " +
      "FROM public.employee_worksite_assignments WHERE id=$1", [assignmentId],
    )).rows[0];
    assert.equal(kept.id, assignmentId);
    assert.equal(kept.organization_id, organizationId);
    assert.equal(kept.employee_id, employeeId);
    assert.equal(kept.worksite_id, worksiteId);
    assert.equal(kept.decision, "allow");
    assert.equal(kept.effective_from, "2026-01-01");

    await expectGuard(db, "P0001", "ISSUE1113_DECISION_ALREADY_PRESENT_REQUIRES_REVIEW");
    await db.query("ROLLBACK");
    inTransaction = false;
    assert.deepEqual(await catalog(db), original,
      "source rehearsal must always restore the initial complete catalog");
    assert.deepEqual((await db.query(
      "SELECT (SELECT count(*)::integer FROM organizations) AS organizations," +
      "(SELECT count(*)::integer FROM employees) AS employees," +
      "(SELECT count(*)::integer FROM payroll_runs) AS payroll_runs," +
      "(SELECT count(*)::integer FROM payroll_entries) AS payroll_entries",
    )).rows[0], initialCounts, "rollback must leave all fictional and money rows absent");

    // A separate session with a held table reader lock must make NOWAIT fail
    // immediately. This denial is deliberately tested after DDL rollback so
    // the rehearsal connection does not itself hold the exclusive DDL lock.
    const holder = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
    await holder.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("LOCK TABLE public.employee_worksite_assignments IN SHARE MODE");
      // The other session holds a compatible reader lock; our candidate must
      // reject its own ACCESS EXCLUSIVE attempt immediately (55P03), even
      // though the intact Drizzle schema already contains the column.
      await assert.rejects(() => db.query(source),
        error => error?.code === "55P03", "concurrent reader lock must fail fast");
    } finally {
      await holder.query("ROLLBACK").catch(() => {});
      await holder.end().catch(() => {});
    }

    console.log(JSON.stringify({
      issue: 1113, postgresMajor: major, sourceSha256,
      migratedInDisposableTransaction: true, rolledBack: true,
      verified: ["source type", "default", "not null", "tenant FKs", "replay refusal", "drift refusal", "rows"],
      numberedMigrationReserved: false, productionApproval: false, actualTenantUat: "NOT_RUN",
    }));
  } finally {
    if (inTransaction) await db.query("ROLLBACK").catch(() => {});
    await db.end().catch(() => {});
  }
});
