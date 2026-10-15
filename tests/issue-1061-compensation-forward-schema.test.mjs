import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import pg from "pg";
import { assertIsolatedMigrationTarget } from "../scripts/lib/isolated-migration-target.mjs";

const file = "drizzle/0126_compensation_governance_forward_repair.sql";
const ddl = readFileSync(file, "utf8");
const expected = {
  compensation_bands: { columns: 16, fks: 5, indexes: 6 },
  compensation_cycles: { columns: 12, fks: 2, indexes: 3 },
  compensation_proposals: { columns: 19, fks: 8, indexes: 3 },
  compensation_components: { columns: 13, fks: 2, indexes: 4 },
  employee_compensation_components: { columns: 20, fks: 6, indexes: 4 },
  compensation_events: { columns: 17, fks: 7, indexes: 3 },
};
const parentNames = [
  "organizations","users","employees","job_profiles","job_grades",
  "legal_entities","worker_effective_changes","employee_pay_revisions",
];
const distinctTables = Object.keys(expected);
const allIndexes = [
  "compensation_bands_pkey", "compensation_bands_org_scope_effective_unique",
  "compensation_bands_org_grade_idx", "compensation_bands_org_legal_entity_idx",
  "compensation_bands_org_effective_idx", "compensation_bands_org_active_idx",
  "compensation_cycles_pkey", "compensation_cycles_org_name_dates_unique",
  "compensation_cycles_org_status_idx",
  "compensation_proposals_pkey", "compensation_proposals_cycle_employee_unique",
  "compensation_proposals_org_status_idx",
  "compensation_components_pkey", "compensation_components_org_code_unique",
  "compensation_components_org_name_unique", "compensation_components_org_active_idx",
  "employee_compensation_components_pkey", "employee_comp_components_active_idx",
  "employee_comp_components_employee_date_idx", "employee_comp_components_status_date_idx",
  "compensation_events_pkey", "compensation_events_employee_date_idx",
  "compensation_events_org_type_idx",
];
const uniqueIndexes = new Set([
  "compensation_bands_pkey", "compensation_bands_org_scope_effective_unique",
  "compensation_cycles_pkey", "compensation_cycles_org_name_dates_unique",
  "compensation_proposals_pkey", "compensation_proposals_cycle_employee_unique",
  "compensation_components_pkey", "compensation_components_org_code_unique",
  "compensation_components_org_name_unique",
  "employee_compensation_components_pkey", "compensation_events_pkey",
]);

const protectedLocal = process.env.CI === "true" &&
  process.env.GITHUB_ACTIONS === "true" &&
  process.env.MIGRATION_REHEARSAL_MODE === "isolated-ci-only" &&
  (() => {
    try {
      const u = new URL(process.env.DATABASE_URL);
      return ["postgresql:", "postgres:"].includes(u.protocol)
        && ["localhost", "127.0.0.1"].includes(u.hostname)
        && u.port === "5432" && u.pathname === "/app_db"
        && u.username === "postgres" && !u.search && !u.hash;
    } catch { return false; }
  })();

test("#1061 candidate is forward-only, guards all 6 absent tables, and has no payroll DML", () => {
  const uncommented = ddl.replace(/--[^\n]*/g, "").trim();
  assert.match(uncommented, /^DO \$comp1061_preflight\$/);
  assert.match(uncommented, /DO \$comp1061_postflight\$/);
  assert.match(uncommented, /COMP1061_PARTIAL_OR_EXISTING_COMPENSATION_SCHEMA/);
  assert.match(uncommented, /COMP1061_MISSING_OR_DRIFTED_PARENT_INTEGER_PK/);
  assert.match(uncommented, /COMP1061_ORPHANED_INDEX_OR_SEQUENCE/);
  assert.match(uncommented, /COMP1061_POSTFLIGHT_INCOMPLETE_FINAL_COMPENSATION_SCHEMA/);
  assert.equal((uncommented.match(/\bCREATE TABLE public\./g)||[]).length, 6);
  for (const table of distinctTables) {
    assert.match(uncommented, new RegExp("CREATE TABLE public\\." + table + "\\s*\\("));
  }
  for (const parent of parentNames) {
    assert.ok(uncommented.includes("('" + parent + "')"),
      "parent id catalog preflight missing " + parent);
  }
  for (const name of allIndexes) {
    assert.ok(uncommented.includes(name), "missing current-schema index " + name);
  }
  assert.doesNotMatch(uncommented, /\bIF\s+NOT\s+EXISTS\b|\bDROP\s+(?:TABLE|INDEX|SCHEMA|DATABASE)\b|\bTRUNCATE\b|\bINSERT\s+INTO\b|\bUPDATE\s+(?:public\.)?[a-z_]+\b|\bDELETE\s+FROM\b|\bALTER\s+TABLE\b/i);
  assert.doesNotMatch(uncommented, /\b(?:FROM|JOIN)\s+(?:public\.)?(?:employees|users|organizations|compensation_cycles|compensation_proposals|payroll_runs)\b/i,
    "preflight may read only PostgreSQL metadata, never employer rows");
  assert.doesNotMatch(uncommented, /\b(?:BEGIN|COMMIT|ROLLBACK)\s*;/i,
    "the protected operator owns the release transaction");
});

test("#1061 exact SQL runs only on isolated CI PG16/18, with full rollback and failure canaries", {
  skip: !protectedLocal, timeout: 120_000,
}, async () => {
  const base = assertIsolatedMigrationTarget();
  const database = "issue1061_" + randomUUID().replaceAll("-", "").slice(0, 16);
  const admin = new pg.Client({ connectionString: base, connectionTimeoutMillis: 5000 });
  let scratch;
  let created = false;
  let inTransaction = false;
  await admin.connect();
  try {
    // All DDL is confined to a new, randomly named disposable localhost DB.
    await admin.query('CREATE DATABASE "' + database + '"');
    created = true;
    const u = new URL(base); u.pathname = "/" + database;
    scratch = new pg.Client({ connectionString: u.toString(), connectionTimeoutMillis: 5000 });
    await scratch.connect();
    await scratch.query("SET statement_timeout = '30000ms'");
    await scratch.query("SET lock_timeout = '5000ms'");

    for (const name of parentNames.filter((name) => name !== "employee_pay_revisions")) {
      await scratch.query('CREATE TABLE public."' + name + '" (id integer PRIMARY KEY)');
    }
    // One missing parent refuses before creating even the first compensation relation.
    await assert.rejects(() => scratch.query(ddl), (error) =>
      error.code === "P0001" && /COMP1061_MISSING_OR_DRIFTED_PARENT_INTEGER_PK/.test(error.message));
    for (const name of distinctTables) {
      const row = (await scratch.query("SELECT to_regclass($1) AS relation", ["public." + name])).rows[0];
      assert.equal(row.relation, null, "missing-parent preflight cannot write " + name);
    }

    await scratch.query("CREATE TABLE public.employee_pay_revisions (id uuid PRIMARY KEY)");
    await assert.rejects(() => scratch.query(ddl), (error) =>
      error.code === "P0001" && /COMP1061_MISSING_OR_DRIFTED_PARENT_INTEGER_PK/.test(error.message));
    await scratch.query("DROP TABLE public.employee_pay_revisions");
    await scratch.query("CREATE TABLE public.employee_pay_revisions (id integer)");
    await assert.rejects(() => scratch.query(ddl), (error) =>
      error.code === "P0001" && /COMP1061_MISSING_OR_DRIFTED_PARENT_INTEGER_PK/.test(error.message));
    await scratch.query("ALTER TABLE public.employee_pay_revisions ADD PRIMARY KEY (id)");

    // Partial relation, sequence, or index namespace collisions must fail.
    await scratch.query("CREATE TABLE public.compensation_cycles (id integer)");
    await assert.rejects(() => scratch.query(ddl), (error) =>
      error.code === "P0001" && /COMP1061_PARTIAL_OR_EXISTING_COMPENSATION_SCHEMA/.test(error.message));
    await scratch.query("DROP TABLE public.compensation_cycles");

    await scratch.query("CREATE SEQUENCE public.compensation_cycles_id_seq");
    await assert.rejects(() => scratch.query(ddl), (error) =>
      error.code === "P0001" && /COMP1061_ORPHANED_INDEX_OR_SEQUENCE/.test(error.message));
    await scratch.query("DROP SEQUENCE public.compensation_cycles_id_seq");

    await scratch.query("CREATE TABLE public.issue1061_collision (id integer)");
    await scratch.query("CREATE INDEX compensation_bands_org_grade_idx ON public.issue1061_collision(id)");
    await assert.rejects(() => scratch.query(ddl), (error) =>
      error.code === "P0001" && /COMP1061_ORPHANED_INDEX_OR_SEQUENCE/.test(error.message));
    await scratch.query("DROP TABLE public.issue1061_collision");

    await scratch.query("BEGIN");
    inTransaction = true;
    await scratch.query(ddl);

    // Verify all six tables, all 97 source columns, all 30 FKs and 23 indexes.
    const present = (await scratch.query(
      "SELECT c.relname AS name, " +
      "(SELECT count(*)::int FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns, " +
      "(SELECT count(*)::int FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid AND k.contype='f' AND k.convalidated) AS fks, " +
      "(SELECT count(*)::int FROM pg_catalog.pg_index i WHERE i.indrelid=c.oid AND i.indisvalid AND i.indisready) AS indexes " +
      "FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace " +
      "WHERE n.nspname='public' AND c.relname = ANY($1::text[]) ORDER BY c.relname",
      [distinctTables],
    )).rows;
    assert.equal(present.length, 6);
    for (const row of present) {
      assert.deepEqual({
        columns: row.columns, fks: row.fks, indexes: row.indexes,
      }, expected[row.name], row.name + " must exactly match current column/FK/index counts");
    }

    const indexes = (await scratch.query(
      "SELECT i.relname AS name, t.relname AS table_name, x.indisunique AS is_unique, " +
      "x.indisvalid AS is_valid, x.indisready AS is_ready " +
      "FROM pg_catalog.pg_index x JOIN pg_catalog.pg_class i ON i.oid=x.indexrelid " +
      "JOIN pg_catalog.pg_class t ON t.oid=x.indrelid " +
      "JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace " +
      "WHERE n.nspname='public' AND t.relname=ANY($1::text[]) ORDER BY i.relname",
      [distinctTables],
    )).rows;
    assert.equal(indexes.length, 23);
    assert.deepEqual(indexes.map((row) => row.name).sort(), [...allIndexes].sort());
    for (const index of indexes) {
      assert.equal(index.is_valid && index.is_ready, true, index.name);
      assert.equal(index.is_unique, uniqueIndexes.has(index.name), index.name);
    }

    // Key application fields retain current Drizzle types/defaults.
    const columns = (await scratch.query(
      "SELECT c.relname AS table_name, a.attname AS column_name, " +
      "pg_catalog.format_type(a.atttypid,a.atttypmod) AS data_type, " +
      "a.attnotnull AS not_null, pg_catalog.pg_get_expr(def.adbin,def.adrelid) AS default_expr " +
      "FROM pg_catalog.pg_attribute a " +
      "JOIN pg_catalog.pg_class c ON c.oid=a.attrelid " +
      "JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace " +
      "LEFT JOIN pg_catalog.pg_attrdef def ON def.adrelid=a.attrelid AND def.adnum=a.attnum " +
      "WHERE n.nspname='public' AND c.relname=ANY($1::text[]) " +
      "AND a.attnum>0 AND NOT a.attisdropped",
      [distinctTables],
    )).rows;
    assert.equal(columns.length, 97);
    const field = (t,n) => columns.find((a) => a.table_name===t && a.column_name===n);
    assert.equal(field("compensation_cycles","budget_pool").data_type, "numeric(14,2)");
    assert.equal(field("compensation_cycles","budget_pool").not_null, true);
    assert.match(field("compensation_cycles","budget_pool").default_expr, /0/);
    assert.equal(field("compensation_proposals","worker_effective_change_id").data_type, "integer");
    assert.equal(field("compensation_bands","effective_from").data_type, "date");
    assert.equal(field("compensation_bands","effective_from").not_null, true);
    assert.equal(field("compensation_events","metadata").data_type, "jsonb");
    assert.match(field("compensation_events","metadata").default_expr, /\{\}/);
    assert.equal(field("employee_compensation_components","status").not_null, true);

    const fkRows = (await scratch.query(
      "SELECT source.relname AS source, target.relname AS target, fk.confdeltype AS del " +
      "FROM pg_catalog.pg_constraint fk JOIN pg_catalog.pg_class source ON source.oid=fk.conrelid " +
      "JOIN pg_catalog.pg_class target ON target.oid=fk.confrelid " +
      "WHERE fk.contype='f' AND source.relname=ANY($1::text[])",
      [distinctTables],
    )).rows;
    assert.equal(fkRows.length, 30);
    assert.ok(fkRows.every((row) => ["a","c","n","r"].includes(row.del)));
    assert.ok(fkRows.some((r) => r.source==="compensation_proposals" &&
      r.target==="employee_pay_revisions" && r.del==="n"));
    assert.ok(fkRows.some((r) => r.source==="compensation_proposals" &&
      r.target==="worker_effective_changes" && r.del==="n"));

    // Synthetic only: current application ON CONFLICT and FK behavior.
    for (const name of parentNames) {
      await scratch.query('INSERT INTO public."' + name + '" (id) VALUES (1), (2)');
    }
    const band = (await scratch.query(
      "INSERT INTO public.compensation_bands " +
      "(organization_id,location_code,effective_from,minimum_annual,midpoint_annual,maximum_annual) " +
      "VALUES (1,'QA1061','2026-01-01',200000,300000,400000) RETURNING id",
    )).rows[0];
    const cycle = (await scratch.query(
      "INSERT INTO public.compensation_cycles " +
      "(organization_id,name,start_date,end_date,effective_date,budget_pool) " +
      "VALUES (1,'Fictional CI review','2026-10-01','2026-11-30','2026-12-15',876543.21) " +
      "ON CONFLICT (organization_id,name,start_date,end_date) " +
      "DO UPDATE SET budget_pool=EXCLUDED.budget_pool RETURNING id,budget_pool,status",
    )).rows[0];
    assert.equal(cycle.budget_pool, "876543.21");
    assert.equal(cycle.status, "draft");
    const proposal = (await scratch.query(
      "INSERT INTO public.compensation_proposals " +
      "(organization_id,cycle_id,employee_id,band_id,current_annual,proposed_annual,reason) " +
      "VALUES (1,$1,1,$2,264000,290000,'Fictional CI only') " +
      "ON CONFLICT (cycle_id,employee_id) DO NOTHING RETURNING id,status",
      [cycle.id,band.id],
    )).rows[0];
    assert.equal(proposal.status,"proposed");
    await scratch.query("SAVEPOINT negative_fk");
    await assert.rejects(() => scratch.query(
      "INSERT INTO public.compensation_proposals " +
      "(organization_id,cycle_id,employee_id,band_id,current_annual,proposed_annual,reason) " +
      "VALUES (1,$1,999,$2,1,2,'Fictional FK violation')",
      [cycle.id,band.id],
    ), (error) => error.code === "23503");
    await scratch.query("ROLLBACK TO SAVEPOINT negative_fk");
    await scratch.query("SAVEPOINT duplicate_proposal");
    await assert.rejects(() => scratch.query(
      "INSERT INTO public.compensation_proposals " +
      "(organization_id,cycle_id,employee_id,band_id,current_annual,proposed_annual,reason) " +
      "VALUES (1,$1,1,$2,1,2,'Fictional duplicate')",
      [cycle.id,band.id],
    ), (error) => error.code === "23505");
    await scratch.query("ROLLBACK TO SAVEPOINT duplicate_proposal");

    // Hard reject attempts to replay the source on an installed schema.
    await scratch.query("SAVEPOINT repeat_rejection");
    await assert.rejects(() => scratch.query(ddl), (error) =>
      error.code === "P0001" && /COMP1061_PARTIAL_OR_EXISTING_COMPENSATION_SCHEMA/.test(error.message));
    await scratch.query("ROLLBACK TO SAVEPOINT repeat_rejection");

    await scratch.query("ROLLBACK");
    inTransaction = false;
    for (const name of distinctTables) {
      const r = (await scratch.query("SELECT to_regclass($1) AS relation", ["public." + name])).rows[0];
      assert.equal(r.relation, null, name + " must fully roll back");
    }
  } finally {
    if (inTransaction && scratch) {
      try { await scratch.query("ROLLBACK"); } catch { /* try cleanup */ }
    }
    if (scratch) {
      try { await scratch.end(); } catch { /* connection may be interrupted */ }
    }
    if (created) {
      try { await admin.query('DROP DATABASE "' + database + '"'); }
      catch (error) { throw new Error("ISSUE1061_ISOLATED_DATABASE_CLEANUP_FAILED", { cause: error }); }
    }
    await admin.end();
  }
});
