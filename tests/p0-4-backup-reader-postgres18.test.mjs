import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import pg from "pg";

// Real PostgreSQL 18 permission behavior; strictly ephemeral localhost
// GitHub Actions service populated with empty, fictional schema fixtures.
const MODE = "isolated-synthetic-pg18";
const LOCAL_URL = "postgresql://postgres:postgres@127.0.0.1:5432/neondb";
const RUN = process.env.P0_4_BACKUP_READER_REHEARSAL_MODE === MODE;
const SOURCE = readFileSync(
  new URL("../scripts/sql/p0-4-proposed-backup-reader-bootstrap.sql", import.meta.url),
  "utf8",
);
const POSTFLIGHT = SOURCE.match(/DO \$p0_4_postflight\$[\s\S]*?\$p0_4_postflight\$;/)?.[0];

test("P0-4: real PG18 enforces NOLOGIN, read-only grants, negative privileges and rollback", {
  skip: !RUN,
  timeout: 120000,
}, async () => {
  assert.equal(process.env.CI, "true", "only disposable automated CI is eligible");
  assert.equal(process.env.BACKUP_READER_TEST_DATABASE_URL, LOCAL_URL,
    "refuse any external or user-supplied database target");
  assert.ok(POSTFLIGHT, "source postflight must be present");
  const admin = new pg.Client({ connectionString: LOCAL_URL, connectionTimeoutMillis: 5000 });
  const reader = new pg.Client({ connectionString: LOCAL_URL, connectionTimeoutMillis: 5000 });
  await admin.connect();
  try {
    const initial = (await admin.query(
      "SELECT current_database() AS db, current_setting('server_version_num')::int AS version",
    )).rows[0];
    assert.equal(initial.db, "neondb");
    assert.ok(initial.version >= 180000 && initial.version < 190000,
      "use real disposable PostgreSQL 18");

    // 136 public empty tables, 134 public sequences, 9 neon_auth empty tables.
    // No actual Neon tenant, payroll or banking records are copied into CI.
    await admin.query("CREATE SCHEMA neon_auth");
    await admin.query([
      "DO $synthetic$",
      "DECLARE i integer;",
      "BEGIN",
      "  FOR i IN 1..136 LOOP",
      "    EXECUTE format('CREATE TABLE public.fixture_table_%s (id integer PRIMARY KEY)',i);",
      "  END LOOP;",
      "  FOR i IN 1..134 LOOP",
      "    EXECUTE format('CREATE SEQUENCE public.fixture_seq_%s',i);",
      "  END LOOP;",
      "  FOR i IN 1..9 LOOP",
      "    EXECUTE format('CREATE TABLE neon_auth.fixture_auth_%s (id integer PRIMARY KEY)',i);",
      "  END LOOP;",
      "END",
      "$synthetic$;",
    ].join("\n"));

    // Local PostgreSQL has no genuine Neon project/branch/endpoint markers.
    await assert.rejects(() => admin.query(SOURCE),
      /P0_4_BACKUP_READER_WRONG_NEON_SOURCE/);
    await admin.query("ROLLBACK");
    assert.equal((await admin.query(
      "SELECT count(*)::int AS n FROM pg_catalog.pg_roles " +
      "WHERE rolname = 'payrollph_backup_reader'",
    )).rows[0].n, 0);

    // Deliberately simulate the expected Neon GUC values on localhost.
    // This tests SQL/permissions, NOT whether actual Neon GUCs are genuine.
    await admin.query(
      "SELECT set_config('neon.project_id', $1, false), " +
      "set_config('neon.branch_id', $2, false), " +
      "set_config('neon.endpoint_id', $3, false)",
      ["calm-wave-70219564", "br-lucky-sound-b79i56jw", "ep-cool-hat-b7e7gpoo"],
    );
    await admin.query(SOURCE);
    const flags = (await admin.query([
      "SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,",
      "rolreplication, rolbypassrls, rolinherit FROM pg_catalog.pg_roles",
      "WHERE rolname = 'payrollph_backup_reader'",
    ].join(" "))).rows[0];
    assert.deepEqual(flags, {
      rolcanlogin: false, rolsuper: false, rolcreatedb: false,
      rolcreaterole: false, rolreplication: false, rolbypassrls: false,
      rolinherit: false,
    });

    // The role is NOLOGIN. The synthetic superuser can SET ROLE only to
    // exercise PostgreSQL's enforcement of the effective reader grants.
    await reader.connect();
    await reader.query("SET ROLE payrollph_backup_reader");
    assert.deepEqual((await reader.query(
      "SELECT id FROM public.fixture_table_1 LIMIT 0",
    )).rows, []);
    assert.deepEqual((await reader.query(
      "SELECT id FROM neon_auth.fixture_auth_1 LIMIT 0",
    )).rows, []);
    await reader.query("SELECT last_value FROM public.fixture_seq_1");
    for (const sql of [
      "INSERT INTO public.fixture_table_1 (id) VALUES (9)",
      "UPDATE public.fixture_table_1 SET id = 9",
      "DELETE FROM public.fixture_table_1",
      "TRUNCATE public.fixture_table_1",
      "INSERT INTO neon_auth.fixture_auth_1 (id) VALUES (9)",
      "CREATE TABLE public.unauthorized_by_reader (id integer)",
      "ALTER TABLE public.fixture_table_1 ADD COLUMN unauthorized integer",
      "CREATE ROLE unauthorized_by_reader",
      "SELECT nextval('public.fixture_seq_1')",
    ]) {
      await assert.rejects(() => reader.query(sql),
        /permission denied|must be owner|not owner|insufficient privilege/i,
        "reader must not execute: " + sql);
    }
    await reader.query("RESET ROLE");

    const scopes = (await admin.query([
      "WITH target_tables AS MATERIALIZED (",
      "  SELECT c.oid FROM pg_catalog.pg_class c",
      "  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace",
      "  WHERE n.nspname IN ('public','neon_auth') AND c.relkind='r'",
      "), target_sequences AS MATERIALIZED (",
      "  SELECT c.oid FROM pg_catalog.pg_class c",
      "  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace",
      "  WHERE n.nspname IN ('public','neon_auth') AND c.relkind='S'",
      ") SELECT",
      "  (SELECT count(*)::int FROM target_tables) AS table_count,",
      "  (SELECT count(*)::int FROM target_sequences) AS sequence_count,",
      "  (SELECT count(*)::int FROM target_tables t",
      "    WHERE pg_catalog.has_table_privilege('payrollph_backup_reader',t.oid,'SELECT'))",
      "    AS table_read_count,",
      "  (SELECT count(*)::int FROM target_tables t",
      "    WHERE pg_catalog.has_table_privilege('payrollph_backup_reader',t.oid,",
      "      'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')) AS table_write_count,",
      "  (SELECT count(*)::int FROM target_sequences s",
      "    WHERE pg_catalog.has_sequence_privilege('payrollph_backup_reader',s.oid,'SELECT'))",
      "    AS sequence_read_count,",
      "  (SELECT count(*)::int FROM target_sequences s",
      "    WHERE pg_catalog.has_sequence_privilege('payrollph_backup_reader',s.oid,'USAGE,UPDATE'))",
      "    AS sequence_mutation_count",
    ].join("\n"))).rows[0];
    assert.deepEqual(scopes, {
      table_count: 145, sequence_count: 134,
      table_read_count: 145, table_write_count: 0,
      sequence_read_count: 134, sequence_mutation_count: 0,
    });

    // Script must not silently reset an existing login role/grants.
    await assert.rejects(() => admin.query(SOURCE),
      /P0_4_BACKUP_READER_ALREADY_EXISTS_REVIEW_MANUALLY/);
    await admin.query("ROLLBACK");

    // Inject unsafe rights in disposable transactions; postflight must
    // reject and rollback, retaining the original restricted role.
    for (const [grant, expected] of [
      ["GRANT UPDATE ON public.fixture_table_1 TO payrollph_backup_reader",
        /P0_4_BACKUP_READER_TABLE_PRIVILEGES_INVALID/],
      ["GRANT USAGE ON SEQUENCE public.fixture_seq_1 TO payrollph_backup_reader",
        /P0_4_BACKUP_READER_SEQUENCE_PRIVILEGES_INVALID/],
      ["GRANT CREATE ON SCHEMA public TO payrollph_backup_reader",
        /P0_4_BACKUP_READER_SCHEMA_PRIVILEGES_INVALID/],
      ["ALTER ROLE payrollph_backup_reader BYPASSRLS",
        /P0_4_BACKUP_READER_FLAGS_UNSAFE/],
    ]) {
      await admin.query("BEGIN");
      await admin.query(grant);
      await assert.rejects(() => admin.query(POSTFLIGHT), expected);
      await admin.query("ROLLBACK");
    }
    assert.deepEqual((await admin.query(
      "SELECT rolcanlogin, rolbypassrls FROM pg_catalog.pg_roles " +
      "WHERE rolname = 'payrollph_backup_reader'",
    )).rows[0], { rolcanlogin: false, rolbypassrls: false });
  } finally {
    try { await reader.query("RESET ROLE"); } catch { /* service disposal */ }
    try { await reader.end(); } catch { /* service disposal */ }
    await admin.end();
  }
});
