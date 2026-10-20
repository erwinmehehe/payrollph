/**
 * #1198 end-to-end disposable recovery: restore a *deliberately missing*
 * six-table WFM demand catalog, then let real server DB tests run afterward.
 *
 * Strict guard runs BEFORE creating any database connection. This is NOT the
 * production migration runner; never call it against Neon, staging, or a
 * shared database. No historical receipts are inserted.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";
import { assertIsolatedMigrationTarget } from "../lib/isolated-migration-target.mjs";

assertIsolatedMigrationTarget(process.env);
if (process.env.PRODUCTION_DATABASE_URL ||
    process.env.PRODUCTION_MIGRATION_AUDIT_DATABASE_URL) {
  throw new Error("ISSUE1198_PRODUCTION_CONNECTION_ENV_REFUSED");
}
const { Client } = pg;
const migration = readFileSync(
  new URL("../../drizzle/0134_wfm_demand_missing_foundation_forward.sql", import.meta.url),
  "utf8",
);
const six = [
  "workforce_demand_import_batches",
  "workforce_demand_observation_revisions",
  "workforce_demand_forecast_issues",
  "workforce_demand_forecast_scores",
  "workforce_demand_staffing_policies",
  "workforce_demand_staffing_policy_events",
];
const dropOrder = [
  "workforce_demand_staffing_policy_events",
  "workforce_demand_forecast_scores",
  "workforce_demand_observation_revisions",
  "workforce_demand_staffing_policies",
  "workforce_demand_forecast_issues",
  "workforce_demand_import_batches",
];
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  try {
    // Worksite/org rows are kept throughout the simulated broken-catalog
    // repair. No fixtures or unrelated employer records are dropped.
    const token = String(Date.now());
    const orgResult = await client.query(
      "INSERT INTO public.organizations(name,legal_name) VALUES ($1,$1) RETURNING id",
      ["Disposable 0134 Preservation " + token],
    );
    const orgId = orgResult.rows[0].id;
    const siteResult = await client.query(
      "INSERT INTO public.worksites(organization_id,code,name,timezone) VALUES ($1,$2,$3,$4) RETURNING id",
      [orgId, "RECOV" + token.slice(-8), "Synthetic preserved worksite", "Asia/Manila"],
    );
    const siteId = siteResult.rows[0].id;
    for (const name of six) {
      const found = await client.query(
        "SELECT to_regclass($1) AS rel", ["public." + name],
      );
      assert.ok(found.rows[0].rel, "Expected freshly pushed source table: " + name);
      const { rows } = await client.query(
        'SELECT count(*)::integer AS amount FROM public."' + name + '"',
      );
      assert.equal(rows[0].amount, 0, "Refuse to drop any non-empty fixture table: " + name);
    }

    // Restrict deletion to the exact six empty tables on the guarded CI-only
    // loopback PG service. No CASCADE: fail if anything else depends on them.
    for (const name of dropOrder) {
      await client.query('DROP TABLE public."' + name + '"');
    }
    for (const name of six) {
      const absent = await client.query("SELECT to_regclass($1) AS rel", ["public." + name]);
      assert.equal(absent.rows[0].rel, null, "Partial catalog simulation failed: " + name);
    }

    // Same candidate SQL as protected forward runner, but a disposable local
    // transaction with no production roles, employee rows, or secret access.
    await client.query(migration);
    for (const name of six) {
      const restored = await client.query("SELECT to_regclass($1) AS rel", ["public." + name]);
      assert.ok(restored.rows[0].rel, "Recovery missing table: " + name);
    }
    const { rows: fkCount } = await client.query(
      "SELECT count(*)::integer AS amount FROM pg_constraint WHERE contype = 'f' AND conname = ANY($1::text[])",
      [[
        "wfm_demand_import_worksite_tenant_fk",
        "wfm_demand_revision_worksite_tenant_fk",
        "wfm_demand_revision_batch_tenant_fk",
        "wfm_demand_issued_worksite_tenant_fk",
        "wfm_demand_score_issue_tenant_fk",
        "wfm_demand_policy_worksite_tenant_fk",
        "wfm_demand_policy_job_tenant_fk",
        "wfm_demand_event_policy_tenant_fk",
        "wfm_demand_event_prior_policy_tenant_fk",
      ]],
    );
    assert.equal(fkCount[0].amount, 9, "All nine composite tenant FKs must survive recovery");

    const { rows: preserved } = await client.query(
      "SELECT count(*)::integer AS amount FROM public.worksites WHERE id=$1 AND organization_id=$2",
      [siteId, orgId],
    );
    assert.equal(preserved[0].amount, 1, "Recovery must preserve existing parent data");
    await client.query("COMMIT");
    console.log("ISSUE1198_DISPOSABLE_APP_RECOVERY_PASS: 6 reconstructed tables, 9 tenant FKs, original parent row preserved");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
} finally {
  await client.end();
}
