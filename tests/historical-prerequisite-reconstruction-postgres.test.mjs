import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import pg from "pg";
import { assertIsolatedMigrationTarget } from "../scripts/lib/isolated-migration-target.mjs";

/**
 * P0-4 evidence only. Tests EXACT historical files against a disposable,
 * freshly generated Drizzle/Postgres fixture, never an employer data clone.
 *
 * Historical source can be structurally valid without ever having been
 * executed against Neon main. Do NOT adopt applied receipts from this test.
 */
const HISTORICAL_SOURCE_TRAIN = Object.freeze([
  "0022_job_architecture_positions.sql",
  "0050_hcm_core_worker_history.sql",
  "0110_provider_events_inbox.sql",
  "0112_wfm_operational_demand_observations.sql",
  "0113_wfm_issued_demand_forecasts.sql",
  "0114_wfm_demand_staffing_policies.sql",
]);

const REPAIR_OBJECTS = Object.freeze([
  "workforce_demand_staffing_policy_events",
  "workforce_demand_staffing_policies",
  "workforce_demand_forecast_scores",
  "workforce_demand_forecast_issues",
  "workforce_demand_observation_revisions",
  "workforce_demand_import_batches",
  "provider_events",
  "worker_employment_events",
  "position_assignments",
  "positions",
  "workforce_plans",
  "job_profiles",
]);

const REHEARSAL = process.env.CI === "true" &&
  process.env.GITHUB_ACTIONS === "true" &&
  process.env.P0_4_HISTORICAL_REHEARSAL === "isolated-ci-only";

function localOnly() {
  return assertIsolatedMigrationTarget({
    ...process.env,
    MIGRATION_REHEARSAL_MODE: process.env.P0_4_HISTORICAL_REHEARSAL,
  });
}

async function queryObjects(client) {
  const { rows } = await client.query(
    "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace " +
    "WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY relname",
  );
  return rows.map(row => row.relname);
}

test("source train uses exact merged numbered SQL, no synthetic replacements", () => {
  assert.equal(HISTORICAL_SOURCE_TRAIN.length, 6);
  for (const name of HISTORICAL_SOURCE_TRAIN) {
    const bytes=readFileSync(new URL("../drizzle/" + name,import.meta.url),"utf8");
    assert.ok(bytes.length > 500,name);
    assert.doesNotMatch(bytes,/^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/mi,
      "transaction must be owned by the review executor");
  }
  const jobs=readFileSync(new URL("../drizzle/0022_job_architecture_positions.sql",import.meta.url),"utf8");
  const hcm=readFileSync(new URL("../drizzle/0050_hcm_core_worker_history.sql",import.meta.url),"utf8");
  assert.match(jobs,/CREATE TABLE IF NOT EXISTS "job_profiles"/);
  assert.match(jobs,/CREATE TABLE IF NOT EXISTS "position_assignments"/);
  assert.match(hcm,/CREATE TABLE IF NOT EXISTS "worker_employment_events"/);
});

test("missing 0022 job tables fail 0114, rollback preserves fixture catalog", {
  skip: !REHEARSAL,timeout:90000,
},async()=>{
  const client=new pg.Client({connectionString:localOnly(),connectionTimeoutMillis:4000});
  await client.connect();
  let transaction=false;
  try{
    const before=await queryObjects(client);
    await client.query("BEGIN");
    transaction=true;
    await client.query("DROP TABLE IF EXISTS public.workforce_demand_staffing_policy_events CASCADE");
    await client.query("DROP TABLE IF EXISTS public.workforce_demand_staffing_policies CASCADE");
    await client.query("DROP TABLE IF EXISTS public.job_profiles CASCADE");
    const sql=readFileSync(new URL("../drizzle/0114_wfm_demand_staffing_policies.sql",import.meta.url),"utf8");
    await assert.rejects(()=>client.query(sql),
      error=>error?.code === "42P01","unrepaired 0022 dependency must reject historical 0114");
    await client.query("ROLLBACK");
    transaction=false;
    assert.deepEqual(await queryObjects(client),before);
  }finally{
    if(transaction)try{await client.query("ROLLBACK");}catch{}
    await client.end();
  }
});

test("exact 0022 → 0050 → 0110 → 0112 → 0113 → 0114 SQL works and fully rolls back",{
  skip:!REHEARSAL,timeout:120000,
},async()=>{
  const client=new pg.Client({connectionString:localOnly(),connectionTimeoutMillis:4000});
  await client.connect();
  let transaction=false;
  try{
    const before=await queryObjects(client);
    const {rows:[countBefore]}=await client.query(
      "SELECT (SELECT count(*)::int FROM public.employees) AS employees," +
      "(SELECT count(*)::int FROM public.payroll_entries) AS entries," +
      "(SELECT count(*)::int FROM public.payroll_runs) AS runs");
    await client.query("BEGIN");
    transaction=true;

    // ONLY the disposable CI fixture. Original schema restored on ROLLBACK.
    for(const name of REPAIR_OBJECTS){
      await client.query('DROP TABLE IF EXISTS public."'+name+'" CASCADE');
    }
    const missing=await client.query(
      "SELECT to_regclass('public.job_profiles') IS NULL AS missing_jobs," +
      "to_regclass('public.provider_events') IS NULL AS missing_events," +
      "to_regclass('public.worker_employment_events') IS NULL AS missing_history");
    assert.deepEqual(missing.rows[0],{
      missing_jobs:true,missing_events:true,missing_history:true,
    });

    for(const file of HISTORICAL_SOURCE_TRAIN){
      const content=readFileSync(new URL("../drizzle/" + file,import.meta.url),"utf8");
      await client.query(content);
    }
    const restored=await queryObjects(client);
    for(const name of REPAIR_OBJECTS){
      assert.ok(restored.includes(name),"historical SQL must create "+name);
    }
    for(const name of [
      "provider_events_provider_event_id_unique",
      "position_assignments_active_primary_employee_unique",
      "wfm_staffing_policy_idempotency_unique",
      "wfm_demand_issued_key_unique",
    ]){
      const {rows:[index]}=await client.query(
        "SELECT to_regclass($1) IS NOT NULL AS present",["public."+name]);
      assert.equal(index.present,true,"missing expected unique index "+name);
    }
    const {rows:[countAfter]}=await client.query(
      "SELECT (SELECT count(*)::int FROM public.employees) AS employees," +
      "(SELECT count(*)::int FROM public.payroll_entries) AS entries," +
      "(SELECT count(*)::int FROM public.payroll_runs) AS runs");
    assert.deepEqual(countAfter,countBefore,"historical schema repair must not rewrite payroll counts");
    for(const table of REPAIR_OBJECTS){
      const {rows:[row]}=await client.query('SELECT count(*)::int AS count FROM public."'+table+'"');
      assert.equal(row.count,0,"the synthetic repair objects must start empty");
    }
    await client.query("ROLLBACK");
    transaction=false;
    assert.deepEqual(await queryObjects(client),before,
      "catalog objects must return to original Drizzle state");
    const {rows:[after]}=await client.query(
      "SELECT (SELECT count(*)::int FROM public.employees) AS employees," +
      "(SELECT count(*)::int FROM public.payroll_entries) AS entries," +
      "(SELECT count(*)::int FROM public.payroll_runs) AS runs");
    assert.deepEqual(after,countBefore);
  }finally{
    if(transaction)try{await client.query("ROLLBACK");}catch{}
    await client.end();
  }
});
