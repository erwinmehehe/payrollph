import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import pg from "pg";
import { assertIsolatedMigrationTarget } from "../scripts/lib/isolated-migration-target.mjs";
import { ISSUE1054_PREFLIGHT_SQL, ISSUE1054_POSTFLIGHT_SQL, ISSUE1054_MIGRATION_PATH } from "../scripts/lib/issue-1054-protected-preflight.mjs";

// Source assertions run on any machine. PostgreSQL scenarios require the CI
// localhost-only app_db schema fixture and an entirely rollback-only transaction.
const source = readFileSync(new URL("../drizzle/0125_wfm_availability_open_shifts_forward_repair.sql", import.meta.url), "utf8");
const preflight = ISSUE1054_PREFLIGHT_SQL;
const targets = ["employee_availability_rules", "open_shifts", "open_shift_claims"];
const ready = process.env.CI === "true" &&
  process.env.GITHUB_ACTIONS === "true" &&
  process.env.MIGRATION_REHEARSAL_MODE === "isolated-ci-only" &&
  process.env.ISSUE_1054_REHEARSAL === "isolated-ci-only";

test("#1054 preflight guards: typed parents, exact index keys, orphan names", () => {
  assert.match(preflight, /ISSUE1054_PARENT_INTEGER_PK_MISSING_OR_DRIFTED/);
  assert.match(preflight, /pg_catalog\.format_type\(id\.atttypid, id\.atttypmod\) <> 'integer'/);
  assert.match(preflight, /i\.indpred IS NULL AND i\.indnkeyatts = 5 AND i\.indnatts = 5/);
  assert.match(preflight, /i\.indisunique AND i\.indisvalid AND i\.indisready AND i\.indislive/);
  assert.match(preflight, /pg_catalog\.pg_get_indexdef\(i\.indexrelid, 5, true\)/);
  assert.doesNotMatch(preflight.replace(/--[^\n]*/g, ""), /\bILIKE\b/i);
  assert.match(preflight, /ISSUE1054_ORPHANED_INDEX_OR_SEQUENCE/);
  assert.match(preflight, /ISSUE1054_RESERVED_CONSTRAINT_NAME_COLLISION/);
  assert.match(ISSUE1054_POSTFLIGHT_SQL, /ISSUE1054_POSTFLIGHT_INCOMPLETE_FINAL_SCHEMA/);
  for (const name of [
    "employee_availability_rules_id_seq", "open_shifts_id_seq",
    "open_shift_claims_id_seq", "open_shifts_role_idx",
    "open_shift_claim_unique", "open_shift_claim_employee_idx",
  ]) assert.ok(preflight.includes("'" + name + "'"), "unguarded reserved name: " + name);
});

async function fingerprint(db) {
  const { rows: [row] } = await db.query(
    "SELECT " +
    "(SELECT md5(coalesce(string_agg(c.relname || ':' || c.relkind::text, '|' " +
      "ORDER BY c.relname,c.relkind::text),'')) FROM pg_catalog.pg_class c " +
      "WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p','i','S')) AS relations, " +
    "(SELECT md5(coalesce(string_agg(c.relname || '.' || a.attname || ':' || " +
      "pg_catalog.format_type(a.atttypid,a.atttypmod), '|' ORDER BY c.relname,a.attname),'')) " +
      "FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid " +
      "WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p') " +
      "AND a.attnum>0 AND NOT a.attisdropped) AS columns, " +
    "(SELECT md5(coalesce(string_agg(k.conrelid::regclass::text || ':' || k.conname || ':' || " +
      "pg_catalog.pg_get_constraintdef(k.oid), '|' ORDER BY k.conrelid::regclass::text,k.conname),'')) " +
      "FROM pg_catalog.pg_constraint k WHERE k.connamespace='public'::regnamespace) AS constraints, " +
    "(SELECT md5(coalesce(string_agg(indexname || ':' || indexdef, '|' ORDER BY indexname),'')) " +
      "FROM pg_catalog.pg_indexes WHERE schemaname='public') AS indexes"
  );
  return row;
}
async function assertTargetsAbsent(db) {
  for (const name of targets) {
    const { rows: [result] } = await db.query(
      "SELECT to_regclass($1) IS NULL AS absent", ["public." + name]);
    assert.equal(result.absent, true, name + " was unexpectedly created");
  }
}
test("#1054 PG16/18: strict P0001 guards, clean create/replay and rollback", {
  skip: !ready,
  timeout: 120000,
}, async () => {
  const connectionString = assertIsolatedMigrationTarget(process.env);
  const db = new pg.Client({
    connectionString, connectionTimeoutMillis: 5000, query_timeout: 90000,
  });
  let inTransaction = false;
  await db.connect();
  try {
    const { rows: [identity] } = await db.query(
      "SELECT current_database() AS db,current_user AS role," +
      "current_setting('server_version_num')::integer AS version");
    const major = Number(process.env.WFM_REHEARSAL_PG_MAJOR);
    assert.ok([16,18].includes(major) && identity.db === "app_db" &&
      identity.role === "postgres" &&
      identity.version >= major * 10000 && identity.version < (major + 1) * 10000,
    "only isolated PG16/18 app_db is supported");
    const { rows: [empty] } = await db.query(
      "SELECT (SELECT count(*)::int FROM organizations) AS tenants," +
      "(SELECT count(*)::int FROM employees) AS employees," +
      "(SELECT count(*)::int FROM payroll_runs) AS runs," +
      "(SELECT count(*)::int FROM payroll_entries) AS entries");
    assert.deepEqual(empty, {tenants:0,employees:0,runs:0,entries:0},
      "disposable schema must be empty of employer/payroll rows");
    for (const name of targets) {
      const { rows: [present] } = await db.query(
        "SELECT to_regclass($1) IS NOT NULL AS present", ["public." + name]);
      assert.ok(present.present, "Drizzle fixture missing " + name);
    }
    const before = await fingerprint(db);
    await db.query("BEGIN");
    inTransaction = true;
    await db.query("SET LOCAL statement_timeout='90000ms'");
    await db.query("SET LOCAL lock_timeout='3000ms'");
    for (const table of [...targets].reverse())
      await db.query('DROP TABLE public."' + table + '"');
    await assertTargetsAbsent(db);
    assert.equal(ISSUE1054_MIGRATION_PATH,
      "drizzle/0125_wfm_availability_open_shifts_forward_repair.sql");
    // Reproduce original immutable 0125 orphan acceptance in a disposable
    // SAVEPOINT, then require the companion guard to reject the same state.
    await db.query("SAVEPOINT issue1054_historic_orphan_repro");
    try {
      await db.query("CREATE SEQUENCE public.open_shifts_id_seq");
      await db.query(source);
      const { rows: [created] } = await db.query(
        "SELECT to_regclass('public.open_shifts_id_seq1') IS NOT NULL AS leaked");
      assert.equal(created.leaked, true,
        "original 0125 silently allocates _seq1 instead of refusing orphan");
    } finally {
      await db.query("ROLLBACK TO SAVEPOINT issue1054_historic_orphan_repro");
      await db.query("RELEASE SAVEPOINT issue1054_historic_orphan_repro");
    }
    await assertTargetsAbsent(db);

    const refused = async (setup, errorCode) => {
      const previous = await fingerprint(db);
      await db.query("SAVEPOINT issue1054_invalid_catalog");
      try {
        for (const sql of setup) await db.query(sql);
        await assert.rejects(() => db.query(preflight), err =>
          err?.code === "P0001" && err.message.includes(errorCode),
        "preflight must fail with explicit " + errorCode);
      } finally {
        await db.query("ROLLBACK TO SAVEPOINT issue1054_invalid_catalog");
        await db.query("RELEASE SAVEPOINT issue1054_invalid_catalog");
      }
      await assertTargetsAbsent(db);
      assert.deepEqual(await fingerprint(db), previous, "unsafe case leaked catalog objects");
    };
    await refused(["DROP TABLE public.job_profiles CASCADE"],
      "ISSUE1054_MISSING_PREREQUISITES");
    await refused([
      "DROP TABLE public.job_profiles CASCADE",
      "CREATE TABLE public.job_profiles (id uuid PRIMARY KEY)",
    ], "ISSUE1054_PARENT_INTEGER_PK_MISSING_OR_DRIFTED");
    await refused([
      "DROP TABLE public.job_profiles CASCADE",
      "CREATE TABLE public.job_profiles (id integer)",
    ], "ISSUE1054_PARENT_INTEGER_PK_MISSING_OR_DRIFTED");
    await refused([
      "DROP TABLE public.job_profiles CASCADE",
      "CREATE TABLE public.job_profiles (id integer, extra integer, PRIMARY KEY (id,extra))",
    ], "ISSUE1054_PARENT_INTEGER_PK_MISSING_OR_DRIFTED");
    await refused(["CREATE SEQUENCE public.open_shifts_id_seq"],
      "ISSUE1054_ORPHANED_INDEX_OR_SEQUENCE");
    await refused([
      "CREATE TABLE public.issue1054_reserved_index_probe (id integer)",
      "CREATE INDEX employee_availability_employee_idx ON public.issue1054_reserved_index_probe (id)",
    ], "ISSUE1054_ORPHANED_INDEX_OR_SEQUENCE");
    await refused([
      "CREATE TABLE public.issue1054_reserved_constraint_probe (id integer)",
      "ALTER TABLE public.issue1054_reserved_constraint_probe ADD CONSTRAINT " +
        "open_shifts_organization_id_organizations_id_fk CHECK (id > 0)",
    ], "ISSUE1054_RESERVED_CONSTRAINT_NAME_COLLISION");
    await refused([
      "DROP INDEX public.staffing_requirement_role_unique",
      "CREATE UNIQUE INDEX staffing_requirement_role_unique ON public.staffing_requirements " +
        "(organization_id,worksite_id,work_date,shift_definition_id," +
        "COALESCE(job_profile_id,0)) WHERE work_date >= '2100-01-01'",
    ], "ISSUE1054_STAFFING_ROLE_INDEX_NOT_FOUND");
    await refused([
      "DROP INDEX public.staffing_requirement_role_unique",
      "CREATE UNIQUE INDEX staffing_requirement_role_unique ON public.staffing_requirements " +
        "(organization_id,worksite_id,work_date,shift_definition_id,COALESCE(job_profile_id,1))",
    ], "ISSUE1054_STAFFING_ROLE_INDEX_NOT_FOUND");
    await refused([
      "DROP INDEX public.staffing_requirement_role_unique",
      "CREATE UNIQUE INDEX staffing_requirement_role_unique ON public.staffing_requirements " +
        "(organization_id,worksite_id,work_date,shift_definition_id,COALESCE(job_profile_id,0)) INCLUDE(id)",
    ], "ISSUE1054_STAFFING_ROLE_INDEX_NOT_FOUND");
    await refused(["DROP INDEX public.staffing_requirement_role_unique"],
      "ISSUE1054_STAFFING_ROLE_INDEX_NOT_FOUND");
    await refused([
      "CREATE UNIQUE INDEX staffing_requirement_unique ON public.staffing_requirements " +
        "(organization_id,worksite_id,work_date,shift_definition_id)",
    ], "ISSUE1054_LEGACY_STAFFING_UNIQUENESS_PRESENT");
    await refused(["CREATE TABLE public.employee_availability_rules (id integer)"],
      "ISSUE1054_PARTIAL_OR_EXISTING_SCHEMA_REQUIRES_RECONCILIATION");

    await db.query(preflight);
    await db.query(source);
    await db.query(ISSUE1054_POSTFLIGHT_SQL);
    for (const name of targets) {
      const { rows: [seq] } = await db.query(
        "SELECT pg_catalog.pg_get_serial_sequence($1,'id') AS seq", ["public." + name]);
      assert.equal(seq.seq, "public." + name + "_id_seq", "unexpected serial owner");
    }
    await db.query("SAVEPOINT issue1054_replay");
    try {
      await assert.rejects(() => db.query(preflight), err =>
        err?.code === "P0001" &&
        err.message.includes("ISSUE1054_PARTIAL_OR_EXISTING_SCHEMA_REQUIRES_RECONCILIATION"));
    } finally {
      await db.query("ROLLBACK TO SAVEPOINT issue1054_replay");
      await db.query("RELEASE SAVEPOINT issue1054_replay");
    }
    await db.query("ROLLBACK");
    inTransaction = false;
    assert.deepEqual(await fingerprint(db), before, "outer rollback altered source catalog");
  } finally {
    if (inTransaction) await db.query("ROLLBACK").catch(()=>{});
    await db.end().catch(()=>{});
  }
});
