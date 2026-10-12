import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import pg from "pg";
import { assertIsolatedMigrationTarget } from "../scripts/lib/isolated-migration-target.mjs";

const REHEARSAL = process.env.PENDING_TRAIN_REHEARSAL_MODE === "isolated-ci-only";
const names = [
  "0115_payout_profiles_foundation.sql",
  "0116_payout_ledger_foundation.sql",
  "0117_inline_first_payroll_journey.sql",
  "0118_wfm_roster_scale_rules.sql",
  "0119_xendit_payout_provider.sql",
  "0120_wfm_punch_evidence.sql",
  "0121_multi_entity_v2_scope_transfer.sql",
];

test("PG16/18: unnumbered entity-interval proposal rejects tenant mismatch and overlaps", {
  skip: !REHEARSAL, timeout: 120000,
}, async () => {
  const client = new pg.Client({ connectionString: isolatedUrl() });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("DROP TABLE IF EXISTS public.employee_entity_assignments, public.employees CASCADE");
    await client.query("CREATE TABLE public.employees(id integer PRIMARY KEY, organization_id integer NOT NULL)");
    await client.query("CREATE TABLE public.employee_entity_assignments(id serial PRIMARY KEY, organization_id integer NOT NULL, employee_id integer NOT NULL, legal_entity_id integer NOT NULL, effective_from date NOT NULL, effective_until date)");
    await client.query("INSERT INTO public.employees VALUES (1,10),(2,20)");
    const sql = readFileSync(new URL("../docs/engineering/migration-proposals/employee-entity-interval-guard.sql", import.meta.url), "utf8");
    await client.query(sql);
    await client.query(sql);
    await client.query("INSERT INTO public.employee_entity_assignments(organization_id,employee_id,legal_entity_id,effective_from,effective_until) VALUES (10,1,100,'2026-01-01','2026-01-31')");
    for (const [statement, error] of [
      ["INSERT INTO public.employee_entity_assignments(organization_id,employee_id,legal_entity_id,effective_from,effective_until) VALUES (10,2,100,'2026-02-01',NULL)", /EMPLOYEE_TENANT_MISMATCH/],
      ["INSERT INTO public.employee_entity_assignments(organization_id,employee_id,legal_entity_id,effective_from,effective_until) VALUES (10,1,101,'2026-01-15','2026-02-01')", /INTERVAL_OVERLAP/],
      ["UPDATE public.employee_entity_assignments SET employee_id=2,organization_id=20 WHERE id=1", /IDENTITY_IMMUTABLE/],
      ["UPDATE public.employee_entity_assignments SET legal_entity_id=101 WHERE id=1", /IDENTITY_IMMUTABLE/],
      ["UPDATE public.employee_entity_assignments SET effective_from='2025-12-31' WHERE id=1", /IDENTITY_IMMUTABLE/],
      ["UPDATE public.employee_entity_assignments SET effective_until='2026-01-30' WHERE id=1", /CLOSED_INTERVAL_IMMUTABLE/],
      ["DELETE FROM public.employee_entity_assignments WHERE id=1", /HISTORY_IMMUTABLE/],
    ]) {
      await client.query("SAVEPOINT invalid_write");
      await assert.rejects(() => client.query(statement), error);
      await client.query("ROLLBACK TO SAVEPOINT invalid_write");
    }
    await client.query("INSERT INTO public.employee_entity_assignments(organization_id,employee_id,legal_entity_id,effective_from,effective_until) VALUES (10,1,101,'2026-02-01',NULL)");
    // Boundaries are inclusive: a closed Jan 31 interval and an open Feb 1
    // interval are adjacent. A closed interval cannot be extended retroactively.
    await client.query("SAVEPOINT invalid_update");
    await assert.rejects(
      () => client.query("UPDATE public.employee_entity_assignments SET effective_until='2026-02-01' WHERE id=1"),
      /CLOSED_INTERVAL_IMMUTABLE/,
    );
    await client.query("ROLLBACK TO SAVEPOINT invalid_update");
    // A genuinely open interval may be closed once, but the closure must not
    // silently rewrite the original employer or start date.
    await client.query("SAVEPOINT valid_close");
    await client.query("UPDATE public.employee_entity_assignments SET effective_until='2026-12-31' WHERE id=2");
    await assert.rejects(() => client.query("UPDATE public.employee_entity_assignments SET effective_until='2027-01-01' WHERE id=2"), /CLOSED_INTERVAL_IMMUTABLE/);
    await client.query("ROLLBACK TO SAVEPOINT valid_close");
    // The open-ended interval prevents any later insert for the same worker.
    await client.query("SAVEPOINT invalid_later");
    await assert.rejects(
      () => client.query("INSERT INTO public.employee_entity_assignments(organization_id,employee_id,legal_entity_id,effective_from,effective_until) VALUES (10,1,101,'2027-01-01',NULL)"),
      /INTERVAL_OVERLAP/,
    );
    await client.query("ROLLBACK TO SAVEPOINT invalid_later");
    assert.equal((await client.query("SELECT count(*)::integer n FROM public.employee_entity_assignments")).rows[0].n, 2);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
});

// Supplemental *concurrent* witness, isolated from public tables in a distinct
// disposable schema. Qualifier rewriting is only for the private test fixture.
test("PG16/18: two writers lock the same employee and reject overlapping intervals", {
  skip: !REHEARSAL, timeout: 120000,
}, async () => {
  const target = isolatedUrl();
  const quotedSchema = '"interval_guard_ci_' + process.pid + "_" + Date.now() + '"';
  const setup = new pg.Client({ connectionString: target, query_timeout: 90000 });
  const first = new pg.Client({ connectionString: target, query_timeout: 90000 });
  const second = new pg.Client({ connectionString: target, query_timeout: 90000 });
  let created = false;
  await setup.connect();
  try {
    await setup.query("CREATE SCHEMA " + quotedSchema);
    created = true;
    await setup.query("CREATE TABLE " + quotedSchema + ".employees(id integer PRIMARY KEY,organization_id integer NOT NULL)");
    await setup.query("CREATE TABLE " + quotedSchema + ".employee_entity_assignments(id serial PRIMARY KEY,organization_id integer NOT NULL,employee_id integer NOT NULL,legal_entity_id integer NOT NULL,effective_from date NOT NULL,effective_until date)");
    await setup.query("INSERT INTO " + quotedSchema + ".employees VALUES(1,10)");
    const ddl = readFileSync(new URL("../docs/engineering/migration-proposals/employee-entity-interval-guard.sql", import.meta.url), "utf8");
    await setup.query("SET search_path TO " + quotedSchema + ",public");
    await setup.query(ddl.replaceAll("public.", quotedSchema + "."));
    await setup.query("RESET search_path");
    await first.connect();
    await second.connect();
    const insert = (entity, from, until) => "INSERT INTO " + quotedSchema + ".employee_entity_assignments(organization_id,employee_id,legal_entity_id,effective_from,effective_until) VALUES(10,1," + entity + ",'" + from + "','" + until + "')";
    await first.query("BEGIN");
    await first.query(insert(100, "2026-01-01", "2026-03-31"));
    await second.query("BEGIN");
    await second.query("SET LOCAL lock_timeout = '500ms'");
    await assert.rejects(() => second.query(insert(101, "2026-02-01", "2026-04-30")), error =>
      error?.code === "55P03", "Second writer must wait for the employee row lock");
    await second.query("ROLLBACK");
    await first.query("COMMIT");
    await second.query("BEGIN");
    await assert.rejects(() => second.query(insert(101, "2026-02-01", "2026-04-30")),
      /ENTITY_ASSIGNMENT_INTERVAL_OVERLAP/);
    await second.query("ROLLBACK");
    const count = await setup.query("SELECT count(*)::integer AS n FROM " + quotedSchema + ".employee_entity_assignments");
    assert.equal(count.rows[0].n, 1);
  } finally {
    await first.query("ROLLBACK").catch(() => {});
    await second.query("ROLLBACK").catch(() => {});
    await first.end().catch(() => {});
    await second.end().catch(() => {});
    try { if (created) await setup.query("DROP SCHEMA " + quotedSchema + " CASCADE"); }
    finally { await setup.end(); }
  }
});

// The source DDL may only run against disposable CI PostgreSQL 16/18.
function isolatedUrl() {
  return assertIsolatedMigrationTarget({
    ...process.env, MIGRATION_REHEARSAL_MODE: process.env.PENDING_TRAIN_REHEARSAL_MODE,
  });
}

const payoutTables = "public.payout_batch_transfers, public.payout_transfers, " +
  "public.payout_batches, public.payout_profiles";

test("PG16/18 synthetic: missing payout prerequisites block proposed 0119 atomically", {
  skip: !REHEARSAL, timeout: 120000,
}, async () => {
  const client = new pg.Client({ connectionString: isolatedUrl(), query_timeout: 90000 });
  await client.connect();
  try {
    await client.query("BEGIN");
    // Synthetic CI ONLY: emulate live schema gap without committing DROP.
    await client.query("DROP TABLE IF EXISTS " + payoutTables + " CASCADE");
    const xendit = readFileSync(new URL("../drizzle/0119_xendit_payout_provider.sql", import.meta.url), "utf8");
    await assert.rejects(() => client.query(xendit), /payout_batches.*does not exist/i);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    const restored = await client.query("SELECT to_regclass('public.payout_batches') IS NOT NULL AS present");
    assert.equal(restored.rows[0].present, true);
    await client.end().catch(() => {});
  }
});

test("PG16/18 synthetic: proposed 0115-0121 source train is fully transactionally reversible", {
  skip: !REHEARSAL, timeout: 120000,
}, async () => {
  // No connection can be opened outside the disposable GitHub Actions DB.
  const url = isolatedUrl();
  const client = new pg.Client({ connectionString: url, query_timeout: 90000 });
  await client.connect();
  let transaction = false;
  try {
    const baseline = await client.query(
      "SELECT count(*)::integer AS count FROM public.payroll_runs");
    // db:push may already have created several proposed schema objects.
    // Compare pre/post catalog state, rather than falsely expecting them
    // absent after the always-rolled-back rehearsal.
    const baselineObjects = await client.query(
      "SELECT to_regclass('public.first_payroll_journey_progress') IS NOT NULL AS first,"+
      "to_regclass('public.user_legal_entity_grants') IS NOT NULL AS grants,"+
      "to_regclass('public.workforce_punch_submissions') IS NOT NULL AS punch");
    await client.query("BEGIN");
    transaction = true;
    // Clear only the disposable test transaction's Drizzle-generated payout
    // objects, then load their ACTUAL proposed 0115/0116 foundations. The
    // entire source train is rolled back, including test-only DROP CASCADE.
    await client.query("DROP TABLE IF EXISTS " + payoutTables + " CASCADE");
    for (const predecessor of names.slice(0, 2)) {
      const sql = readFileSync(new URL("../drizzle/" + predecessor, import.meta.url), "utf8");
      await client.query(sql);
    }
    const immutability = await client.query(
      "SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.payout_transfers'::regclass " +
      "AND NOT tgisinternal AND tgname = 'payout_transfer_identity_guard'");
    assert.equal(immutability.rows.length, 1);
    for (const name of names.slice(2)) {
      const sql = readFileSync(new URL("../drizzle/" + name, import.meta.url), "utf8");
      if (name.startsWith("0121")) {
        assert.doesNotMatch(sql, /(?:^|\n)\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/mi);
      }
      await client.query(sql);
    }
    const present = await client.query(
      "SELECT to_regclass('public.first_payroll_journey_progress') IS NOT NULL AS first," +
      "to_regclass('public.workforce_roster_rule_policies') IS NOT NULL AS roster," +
      "to_regclass('public.workforce_punch_submissions') IS NOT NULL AS punch," +
      "to_regclass('public.user_legal_entity_grants') IS NOT NULL AS grant_table," +
      "to_regclass('public.entity_transfer_requests') IS NOT NULL AS transfer_table");
    assert.deepEqual(present.rows[0], {
      first: true, roster: true, punch: true, grant_table: true, transfer_table: true,
    });
    const provider = await client.query(
      "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint " +
      "WHERE conrelid = 'public.payout_batches'::regclass " +
      "AND conname = 'payout_batches_provider_check'");
    assert.equal(provider.rows.length, 1);
    assert.match(provider.rows[0].definition, /xendit/);
    await client.query("ROLLBACK");
    transaction = false;

    const after = await client.query(
      "SELECT to_regclass('public.first_payroll_journey_progress') IS NOT NULL AS first,"+
      "to_regclass('public.user_legal_entity_grants') IS NOT NULL AS grants,"+
      "to_regclass('public.workforce_punch_submissions') IS NOT NULL AS punch");
    assert.deepEqual(after.rows[0], baselineObjects.rows[0],
      "synthetic full-train replay must preserve the original catalog state");
    const sourceTotals = await client.query(
      "SELECT count(*)::integer AS count FROM public.payroll_runs");
    assert.equal(sourceTotals.rows[0].count, baseline.rows[0].count);
  } finally {
    if (transaction) {
      try { await client.query("ROLLBACK"); } catch { /* disposable test database */ }
    }
    await client.end().catch(() => {});
  }
});
