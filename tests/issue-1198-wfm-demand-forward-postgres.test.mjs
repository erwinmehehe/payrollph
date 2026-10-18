import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertIsolatedMigrationTarget } from "../scripts/lib/isolated-migration-target.mjs";

// This suite connects ONLY to a disposable localhost PostgreSQL CI service.
// It neither accepts real employer data nor connects to Neon or production.
const MIGRATION = readFileSync(
  new URL("../drizzle/0134_wfm_demand_missing_foundation_forward.sql", import.meta.url),
  "utf8",
);
const EXPECTED = [
  "workforce_demand_import_batches",
  "workforce_demand_observation_revisions",
  "workforce_demand_forecast_issues",
  "workforce_demand_forecast_scores",
  "workforce_demand_staffing_policies",
  "workforce_demand_staffing_policy_events",
];

async function mustRejectFk(client, sql, args) {
  await client.query("SAVEPOINT tenant_negative");
  await assert.rejects(
    () => client.query(sql, args),
    error => error?.code === "23503",
    "a cross-organization FK must fail with SQLSTATE 23503",
  );
  await client.query("ROLLBACK TO SAVEPOINT tenant_negative");
  await client.query("RELEASE SAVEPOINT tenant_negative");
}

test("0134 rejects unguarded and external database environments before connecting", () => {
  assert.throws(() => assertIsolatedMigrationTarget({
    CI: "true", GITHUB_ACTIONS: "true", MIGRATION_REHEARSAL_MODE: "wrong",
    DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/app_db",
  }), /MIGRATION_REHEARSAL_CI_ONLY/);
  assert.throws(() => assertIsolatedMigrationTarget({
    CI: "true", GITHUB_ACTIONS: "true",
    MIGRATION_REHEARSAL_MODE: "isolated-ci-only",
    DATABASE_URL: "postgres://postgres:postgres@remote.example:5432/app_db",
  }), /MIGRATION_REHEARSAL_DISPOSABLE_DB_ONLY/);
});

test("0134 forward recovery: six creators, tenant FK denial and atomic rollback", {
  skip: process.env.MIGRATION_REHEARSAL_MODE === "isolated-ci-only"
    ? false
    : "requires the explicitly guarded disposable PostgreSQL CI service",
}, async () => {
  // Refuse before creating a client if the runner isn't the exact isolated CI
  // target. Never allow a production/staging/Neon URL as an alternative.
  const target = assertIsolatedMigrationTarget(process.env);
  const { Client } = await import("pg");
  const client = new Client({ connectionString: target, connectionTimeoutMillis: 4000 });
  await client.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query(`
      CREATE TABLE public.organizations(id integer PRIMARY KEY);
      CREATE TABLE public.users(id integer PRIMARY KEY);
      CREATE TABLE public.worksites(
        id integer PRIMARY KEY,
        organization_id integer NOT NULL REFERENCES public.organizations(id));
      CREATE TABLE public.job_profiles(
        id integer PRIMARY KEY,
        organization_id integer NOT NULL REFERENCES public.organizations(id));
      INSERT INTO public.organizations(id) VALUES (1),(2);
      INSERT INTO public.users(id) VALUES (101),(102);
      INSERT INTO public.worksites(id,organization_id) VALUES (11,1),(22,2);
      INSERT INTO public.job_profiles(id,organization_id) VALUES (111,1),(222,2);
    `);
    await client.query(MIGRATION);
    const { rows } = await client.query(`
      SELECT c.relname FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r'
        AND c.relname LIKE 'workforce_demand_%'
      ORDER BY c.relname`);
    assert.deepEqual(rows.map(r => r.relname), [...EXPECTED].sort());
    const foreignKeys = await client.query(`
      SELECT conname FROM pg_catalog.pg_constraint
      WHERE contype='f' AND conname LIKE 'wfm_demand_%_tenant_fk'`);
    assert.equal(foreignKeys.rows.length, 9,
      "nine composite tenant FK constraints must actually be installed");

    const importSql = `INSERT INTO public.workforce_demand_import_batches
      (organization_id, worksite_id, source_key, metric_kind, interval_minutes,
       idempotency_key, request_sha256, row_count, created_by_user_id)
      VALUES ($1,$2,'synthetic','visits',15,$3,repeat('a',64),1,101) RETURNING id`;
    await mustRejectFk(client, importSql, [1,22,"cross-worksite"]);
    const batch = await client.query(importSql,[1,11,"same-worksite"]);
    const batchId = batch.rows[0].id;

    await mustRejectFk(client, `INSERT INTO public.workforce_demand_observation_revisions
      (organization_id,worksite_id,import_batch_id,source_key,metric_kind,
       interval_start,interval_minutes,revision,observed_count,quality)
      VALUES (2,22,$1,'synthetic','visits',now(),15,1,5,'complete')`,[batchId]);

    const issue = await client.query(`INSERT INTO public.workforce_demand_forecast_issues
      (organization_id,worksite_id,source_key,metric_kind,interval_minutes,
       horizon_days,idempotency_key,request_sha256,issued_at,source_cutoff_at,
       training_evidence_sha256,snapshot_sha256,points_count,snapshot)
      VALUES (1,11,'synthetic','visits',15,7,'issue-1',repeat('a',64),
              now(),now(),repeat('b',64),repeat('c',64),1,'{}'::jsonb)
      RETURNING id`);
    await mustRejectFk(client,`INSERT INTO public.workforce_demand_forecast_scores
      (organization_id,issue_id,scored_at,evaluation_cutoff_at,points_count,
       report_sha256,report)
      VALUES (2,$1,now(),now(),1,repeat('a',64),'{}'::jsonb)`,[issue.rows[0].id]);

    const policySql = `INSERT INTO public.workforce_demand_staffing_policies
      (organization_id,worksite_id,job_profile_id,metric_kind,interval_minutes,
       effective_from,effective_until,version,productive_units_per_worker_hour,
       service_target_coverage_percent,rationale,idempotency_key,content_sha256,
       proposed_by_user_id)
      VALUES (1,11,$1,'visits',15,'2026-11-01','2026-11-30',1,
              12.0000,90.00,'Synthetic isolated acceptance','policy-1',
              repeat('a',64),101) RETURNING id`;
    await mustRejectFk(client,policySql,[222]);
    const validPolicy=await client.query(policySql,[111]);
    assert.equal(validPolicy.rows.length,1);

    // A second application must be denied even when all six objects exist.
    // Never accept CREATE TABLE IF NOT EXISTS as an equivalent success.
    await client.query("SAVEPOINT replay_negative");
    await assert.rejects(() => client.query(MIGRATION),
      error => /ISSUE1198_ALREADY_PRESENT_OR_PARTIAL_STATE/.test(error.message));
    await client.query("ROLLBACK TO SAVEPOINT replay_negative");
    await client.query("RELEASE SAVEPOINT replay_negative");
    await client.query("ROLLBACK");
    transactionOpen = false;

    const after=await client.query(`SELECT count(*)::integer AS remaining
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n
      ON n.oid=c.relnamespace WHERE n.nspname='public'
      AND c.relname LIKE 'workforce_demand_%'`);
    assert.equal(after.rows[0].remaining,0,
      "all six new objects and indexes must disappear after rollback");

    await client.query("BEGIN");
    transactionOpen=true;
    // A missing required parent must fail BEFORE creating the first table.
    await client.query(`
      CREATE TABLE public.organizations(id integer PRIMARY KEY);
      CREATE TABLE public.users(id integer PRIMARY KEY);
      CREATE TABLE public.worksites(id integer PRIMARY KEY, organization_id integer);
    `);
    await assert.rejects(() => client.query(MIGRATION),
      error => /ISSUE1198_MISSING_REQUIRED_PARENTS/.test(error.message));
    await client.query("ROLLBACK");
    transactionOpen=false;
  } finally {
    if (transactionOpen) {
      try { await client.query("ROLLBACK"); } catch { /* failed TX cleanup */ }
    }
    await client.end();
  }
});
