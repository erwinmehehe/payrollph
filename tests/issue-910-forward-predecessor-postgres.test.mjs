import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import pg from "pg";
import { assertIsolatedMigrationTarget } from "../scripts/lib/isolated-migration-target.mjs";

/**
 * #910 unapproved predecessor source: runnable ONLY against the short-lived
 * local PostgreSQL service container in the explicitly pinned CI job.
 * No external hostname, restored branch, Neon connection, or real worker rows.
 */
const REHEARSAL = process.env.CI === "true" &&
  process.env.GITHUB_ACTIONS === "true" &&
  process.env.ISSUE_910_REHEARSAL === "isolated-ci-only";

const paths = [
  "drizzle/0022_job_architecture_positions.sql",
  "drizzle/0050_hcm_core_worker_history.sql",
  "drizzle/0052_hcm_effective_dated_changes.sql",
  "drizzle/0110_provider_events_inbox.sql",
  "drizzle/0112_wfm_operational_demand_observations.sql",
  "drizzle/0113_wfm_issued_demand_forecasts.sql",
  "drizzle/0114_wfm_demand_staffing_policies.sql",
];
const missingLive = Object.freeze([
  "workforce_demand_staffing_policy_events",
  "workforce_demand_staffing_policies",
  "workforce_demand_forecast_scores",
  "workforce_demand_forecast_issues",
  "workforce_demand_observation_revisions",
  "workforce_demand_import_batches",
  "provider_events",
  "worker_effective_changes",
  "worker_employment_events",
  "position_assignments",
  "positions",
  "job_profiles",
]);
const source=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8").trimEnd();
const proposed=readFileSync(
  new URL("../docs/sql/issue-910-review-only-forward-predecessor.sql",import.meta.url),"utf8");

function stage(path){
  const start="-- SOURCE STAGE "+path+"\n";
  const end="\n-- SOURCE END "+path+"\n";
  const from=proposed.indexOf(start);
  assert.ok(from>=0,"missing provenance header for "+path);
  const to=proposed.indexOf(end,from+start.length);
  assert.ok(to>from+start.length,"missing stage end for "+path);
  return proposed.slice(from+start.length,to).trimEnd();
}
function isolatedUrl(){
  return assertIsolatedMigrationTarget({
    ...process.env,
    MIGRATION_REHEARSAL_MODE:process.env.ISSUE_910_REHEARSAL,
  });
}
async function tableCount(client,table){
  const r=await client.query('SELECT count(*)::int AS count FROM public."'+table+'"');
  return r.rows[0].count;
}
async function catalog(client){
  const result=await client.query(
    "SELECT relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n " +
    "ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY relname");
  return result.rows.map(x=>x.relname);
}
async function totals(client){
  const r=await client.query(
    "SELECT (SELECT count(*)::int FROM employees) AS employees, " +
    "(SELECT count(*)::int FROM payroll_runs) AS runs, " +
    "(SELECT count(*)::int FROM payroll_entries) AS entries, " +
    "(SELECT COALESCE(sum(gross_pay),0)::numeric(20,2)::text FROM payroll_entries) AS gross, " +
    "(SELECT COALESCE(sum(net_pay),0)::numeric(20,2)::text FROM payroll_entries) AS net");
  return r.rows[0];
}

test("#910 source-faithful predecessor excludes ONLY unsafe 0050 employee-based UPDATE",()=>{
  assert.match(proposed,/REVIEW-ONLY FORWARD PREDECESSOR/);
  assert.match(proposed,/NOT AN AUTHORIZED MIGRATION/);
  assert.equal(paths.length,7);
  for(let i=0;i<paths.length;i++){
    const historic=source(paths[i]);
    if(i===1){
      const at=historic.indexOf('UPDATE "positions" AS p');
      assert.ok(at>0,"historical 0050 must still have the unsafe UPDATE");
      assert.equal(stage(paths[i]),historic.slice(0,at).trimEnd());
    }else{
      assert.equal(stage(paths[i]),historic);
    }
  }
  assert.doesNotMatch(proposed.replace(/--[^\n]*/g,""),
    /^\s*(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE|COMMIT|ROLLBACK)\b/im);
  assert.match(stage(paths[1]),/CREATE TABLE IF NOT EXISTS "worker_employment_events"/);
  assert.match(stage(paths[2]),/CREATE TABLE IF NOT EXISTS "worker_effective_changes"/);
  assert.doesNotMatch(stage(paths[1]),/SET "legal_entity_id" = e\."legal_entity_id"/);
});

test("#910 synthetic live-shaped partial catalog: repair DDL is repeatable, data-stable, and fully rolled back",{
  skip:!REHEARSAL,timeout:120000,
},async()=>{
  const client=new pg.Client({
    connectionString:isolatedUrl(),connectionTimeoutMillis:4500,query_timeout:80000
  });
  await client.connect();
  let inTransaction=false;
  try{
    const baselineTables=await catalog(client);
    const baselineTotals=await totals(client);
    await client.query("BEGIN");
    inTransaction=true;
    // Recreate the missing-only state from read-only Neon catalog evidence.
    // DROP CASCADE is permitted ONLY inside this disposable CI transaction.
    for(const name of missingLive){
      await client.query('DROP TABLE IF EXISTS public."'+name+'" CASCADE');
    }
    const result=await client.query(
      "SELECT to_regclass('public.workforce_plans') IS NOT NULL AS present, " +
      "to_regclass('public.job_profiles') IS NULL AS no_jobs, " +
      "to_regclass('public.worker_employment_events') IS NULL AS no_history");
    assert.deepEqual(result.rows[0],{present:true,no_jobs:true,no_history:true});
    const actor=await client.query(
      "INSERT INTO organizations(name,legal_name) VALUES('910 synthetic','910 synthetic') RETURNING id");
    const tenant=actor.rows[0].id;
    await client.query(
      "INSERT INTO workforce_plans(organization_id,name,start_date,end_date,budget,status)" +
      " VALUES($1,'preserve plan','2026-01-01','2026-12-31',1234.56,'draft')",[tenant]);
    const originalPlan=await client.query(
      "SELECT id,organization_id,name,start_date::text,end_date::text,budget::text,status " +
      "FROM workforce_plans WHERE organization_id=$1",[tenant]);
    const originalColumns=await client.query(
      "SELECT column_name,udt_name,is_nullable FROM information_schema.columns " +
      "WHERE table_schema='public' AND table_name='workforce_plans' ORDER BY ordinal_position");
    const originalIndexes=await client.query(
      "SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' " +
      "AND tablename='workforce_plans' ORDER BY indexname");
    const employer=await client.query(
      "INSERT INTO legal_entities(organization_id,code,legal_name,display_name,primary_entity)" +
      " VALUES($1,'MAIN','910 synthetic','910 synthetic',true) RETURNING id",[tenant]);
    const worker=await client.query(
      "INSERT INTO employees(organization_id,legal_entity_id,employee_no,first_name,last_name,title,"+
      "avatar_initials,basic_rate,start_date)"+
      " VALUES($1,$2,'HIS-1','Test','Worker','Staff','TW',12345.67,'2025-01-01') RETURNING id",
      [tenant,employer.rows[0].id]);
    const payrollRun=await client.query(
      "INSERT INTO payroll_runs(organization_id,legal_entity_id,period_label,period_start,period_end,pay_date)"+
      " VALUES($1,$2,'Test 1','2026-09-01','2026-09-15','2026-09-15') RETURNING id",
      [tenant,employer.rows[0].id]);
    await client.query(
      "INSERT INTO payroll_entries(payroll_run_id,employee_id,gross_pay,deductions,net_pay)"+
      " VALUES($1,$2,12345.67,1000.01,11345.66)",
      [payrollRun.rows[0].id,worker.rows[0].id]);
    const before=await totals(client);
    assert.equal(before.gross,"12345.67");
    assert.equal(before.net,"11345.66");
    // Never call the production Neon SQL interface with this DDL.
    await client.query(proposed);
    await client.query(proposed);
    for(const name of missingLive){
      const r=await client.query("SELECT to_regclass($1) IS NOT NULL AS present",["public."+name]);
      assert.equal(r.rows[0].present,true,"missing expected forward repair object "+name);
    }
    for(const name of [
      "worker_employment_events","worker_effective_changes","provider_events",
      "position_assignments","positions","job_profiles",
    ]){
      assert.equal(await tableCount(client,name),0,
        "do not manufacture backdated employment, provider or positions rows");
    }
    const afterPlan=await client.query(
      "SELECT id,organization_id,name,start_date::text,end_date::text,budget::text,status " +
      "FROM workforce_plans WHERE organization_id=$1",[tenant]);
    assert.deepEqual(afterPlan.rows,originalPlan.rows,"existing workforce plans must remain untouched");
    assert.deepEqual((await client.query(
      "SELECT column_name,udt_name,is_nullable FROM information_schema.columns "+
      "WHERE table_schema='public' AND table_name='workforce_plans' ORDER BY ordinal_position")).rows,
      originalColumns.rows,"existing workforce_plans columns must be preserved");
    assert.deepEqual((await client.query(
      "SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' " +
      "AND tablename='workforce_plans' ORDER BY indexname")).rows,originalIndexes.rows);
    assert.deepEqual(await totals(client),before,
      "synthetic existing employee/payroll/net/gross money remains immutable");
    await client.query("ROLLBACK");
    inTransaction=false;
    assert.deepEqual(await catalog(client),baselineTables,"all catalog changes roll back");
    assert.deepEqual(await totals(client),baselineTotals,"all money/worker changes roll back");
  }finally{
    if(inTransaction) await client.query("ROLLBACK").catch(()=>{});
    await client.end().catch(()=>{});
  }
});
