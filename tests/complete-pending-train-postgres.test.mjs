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
    // Replaying foundations must not fail on already-installed tenant guards.
    for (const name of names.slice(0, 2)) {
      await client.query(readFileSync(new URL("../drizzle/" + name, import.meta.url), "utf8"));
    }
    const assignmentGuard = await client.query(
      "SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.employee_entity_assignments'::regclass " +
      "AND NOT tgisinternal AND tgname = 'employee_entity_assignment_guard'");
    assert.equal(assignmentGuard.rows.length, 1);
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
