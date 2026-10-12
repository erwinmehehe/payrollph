import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import pg from "pg";
import { assertIsolatedMigrationTarget } from "../scripts/lib/isolated-migration-target.mjs";

const REHEARSAL = process.env.PENDING_TRAIN_REHEARSAL_MODE === "isolated-ci-only";
const names = [
  "0115_inline_first_payroll_journey.sql",
  "0116_wfm_roster_scale_rules.sql",
  "0117_xendit_payout_provider.sql",
  "0118_wfm_punch_evidence.sql",
  "0119_multi_entity_v2_scope_transfer.sql",
];

test("PG16 synthetic: 0115-0119 apply in one transaction and roll back completely", {
  skip: !REHEARSAL, timeout: 120000,
}, async () => {
  // No connection can be opened outside the disposable GitHub Actions DB.
  const url = assertIsolatedMigrationTarget({
    ...process.env, MIGRATION_REHEARSAL_MODE: process.env.PENDING_TRAIN_REHEARSAL_MODE,
  });
  const client = new pg.Client({ connectionString: url, query_timeout: 90000 });
  await client.connect();
  let transaction = false;
  try {
    const baseline = await client.query(
      "SELECT count(*)::integer AS count FROM public.payroll_runs");
    await client.query("BEGIN");
    transaction = true;
    for (const name of names) {
      const sql = readFileSync(new URL("../drizzle/" + name, import.meta.url), "utf8");
      if (name.startsWith("0119")) {
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
      "SELECT to_regclass('public.first_payroll_journey_progress') IS NULL AS no_first," +
      "to_regclass('public.user_legal_entity_grants') IS NULL AS no_grants," +
      "to_regclass('public.workforce_punch_submissions') IS NULL AS no_punch");
    assert.deepEqual(after.rows[0], {no_first: true, no_grants: true, no_punch: true});
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
