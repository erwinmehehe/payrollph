import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import { assertIsolatedMigrationTarget } from "../scripts/lib/isolated-migration-target.mjs";
import { buildReviewOnlyForwardSchema } from "../scripts/issue-910-build-forward-schema.mjs";

/**
 * #910: ONLY GitHub Actions postgres 16/18 localhost fixture. The script
 * intentionally rolls back EVERY schema and synthetic row change.
 */
const REHEARSAL = process.env.CI === "true" &&
  process.env.GITHUB_ACTIONS === "true" &&
  process.env.ISSUE_910_REHEARSAL === "isolated-ci-only";
const missingPredecessors = [
  "workforce_demand_staffing_policy_events", "workforce_demand_staffing_policies",
  "workforce_demand_forecast_scores", "workforce_demand_forecast_issues",
  "workforce_demand_observation_revisions", "workforce_demand_import_batches",
  "provider_events", "worker_effective_changes", "worker_employment_events",
  "job_grades", "job_levels", "job_families", "position_assignments",
  "positions", "job_profiles",
];
async function summary(client) {
  const { rows: [r] } = await client.query(
    "SELECT (SELECT count(*)::int FROM organizations) AS tenants," +
    " (SELECT count(*)::int FROM employees) AS workers," +
    " (SELECT count(*)::int FROM payroll_runs) AS runs," +
    " (SELECT count(*)::int FROM payroll_entries) AS entries," +
    " (SELECT coalesce(sum(gross_pay),0)::numeric(20,2)::text FROM payroll_entries) AS gross," +
    " (SELECT coalesce(sum(net_pay),0)::numeric(20,2)::text FROM payroll_entries) AS net",
  );
  return r;
}
async function tables(client) {
  const { rows } = await client.query(
    "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace " +
    "WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname",
  );
  return rows.map(x => x.relname);
}
async function denied(client, sql, params, expected = "23503") {
  await client.query("SAVEPOINT invalid_scope");
  await assert.rejects(() => client.query(sql, params),
    e => e.code === expected, "must reject cross-tenant or cross-employer write");
  await client.query("ROLLBACK TO SAVEPOINT invalid_scope");
  await client.query("RELEASE SAVEPOINT invalid_scope");
}
const count = async (client, table) =>
  Number((await client.query('SELECT count(*)::integer AS n FROM public."' + table + '"')).rows[0].n);

test("#910: composed predecessor+0121 schema-only migration is atomic, safe to retry and tenant-denying", {
  skip: !REHEARSAL, timeout: 120000,
}, async () => {
  const url = assertIsolatedMigrationTarget({
    ...process.env, MIGRATION_REHEARSAL_MODE: process.env.ISSUE_910_REHEARSAL,
  });
  const db = new pg.Client({ connectionString: url, connectionTimeoutMillis: 4500, query_timeout: 100000 });
  const { sql, manifest } = buildReviewOnlyForwardSchema();
  assert.equal(manifest.includes_historical_backfill, false);
  await db.connect();
  let transaction = false;
  try {
    const initial = { tables: await tables(db), totals: await summary(db) };
    await db.query("BEGIN");
    transaction = true;
    // Emulate the read-only live Neon catalog, using disposable DB ONLY.
    for (const table of [
      "entity_transfer_requests", "employee_entity_assignments",
      "user_entity_preferences", "user_legal_entity_grants", ...missingPredecessors,
    ]) await db.query('DROP TABLE IF EXISTS public."' + table + '" CASCADE');
    assert.equal((await db.query(
      "SELECT to_regclass('public.worker_employment_events') IS NULL AS missing"
    )).rows[0].missing, true);

    // The source must stop before touching anything if canonical 0115-0120
    // prerequisite tables are absent. The SAVEPOINT restores the artificial
    // missing table, not any live object.
    const schemaBefore = await tables(db);
    await db.query("SAVEPOINT prerequisite_negative");
    await db.query("DROP TABLE IF EXISTS public.payout_batches CASCADE");
    await assert.rejects(() => db.query(sql), error =>
      error.code === "P0001" && error.message.includes("ISSUE910_MISSING_SCHEMA_PREREQUISITES"));
    await db.query("ROLLBACK TO SAVEPOINT prerequisite_negative");
    await db.query("RELEASE SAVEPOINT prerequisite_negative");
    assert.deepEqual(await tables(db), schemaBefore, "failed preflight must be atomic");

    const [a, b] = (await db.query(
      "INSERT INTO organizations(name,legal_name) VALUES" +
      "('910 fictional tenant A','910 fictional tenant A')," +
      "('910 fictional tenant B','910 fictional tenant B') RETURNING id",
    )).rows.map(x => x.id);
    const [a1, a2, b1] = (await db.query(
      "INSERT INTO legal_entities(organization_id,code,legal_name,display_name,primary_entity)" +
      " VALUES($1,'A1','A1','A1',true),($1,'A2','A2','A2',false)," +
      " ($2,'B1','B1','B1',true) RETURNING id", [a, b],
    )).rows.map(x => x.id);
    const [staffA, staffB] = (await db.query(
      "INSERT INTO users(name,email,password_hash,role) VALUES" +
      "('Fictional A','issue910-schema-A@example.test','fictional','hr')," +
      "('Fictional B','issue910-schema-B@example.test','fictional','hr') RETURNING id",
    )).rows.map(x => x.id);
    await db.query("INSERT INTO user_organizations(organization_id,user_id,role)" +
      "VALUES($1,$2,'hr'),($3,$4,'hr')", [a, staffA, b, staffB]);
    const [workerA, workerB] = (await db.query(
      "INSERT INTO employees(organization_id,legal_entity_id,employee_no,first_name,last_name,title," +
      "avatar_initials,basic_rate,start_date) VALUES" +
      "($1,$2,'A-1','Synthetic','Worker','Staff','SW',10000.00,'2026-01-01')," +
      "($3,$4,'B-1','Synthetic','Worker','Staff','SW',20000.00,'2026-01-01') RETURNING id",
      [a, a1, b, b1],
    )).rows.map(x => x.id);
    const [runA] = (await db.query(
      "INSERT INTO payroll_runs(organization_id,legal_entity_id,period_label,period_start,period_end,pay_date) " +
      "VALUES($1,$2,'Synthetic','2026-09-01','2026-09-15','2026-09-15') RETURNING id",
      [a, a1],
    )).rows.map(x => x.id);
    const [entryA] = (await db.query(
      "INSERT INTO payroll_entries(payroll_run_id,employee_id,gross_pay,deductions,net_pay)" +
      "VALUES($1,$2,10000.00,1100.01,8899.99) RETURNING id",
      [runA, workerA],
    )).rows.map(x => x.id);
    const moneyBeforeDDL = await summary(db);

    await db.query(sql);
    for (const table of [...missingPredecessors, "entity_transfer_requests",
      "employee_entity_assignments", "user_legal_entity_grants", "user_entity_preferences"]) {
      const { rows } = await db.query("SELECT to_regclass($1) IS NOT NULL AS present", ["public." + table]);
      assert.equal(rows[0].present, true, "missing additive table " + table);
    }
    assert.equal(await count(db, "worker_employment_events"), 0,
      "must not manufacture historical employer transfer events");
    assert.equal(await count(db, "employee_entity_assignments"), 0,
      "must not infer worker history from current legal entity");
    assert.equal(await count(db, "user_legal_entity_grants"), 0,
      "must not silently grant group-wide employer visibility");
    assert.equal((await db.query(
      "SELECT legal_entity_id FROM payroll_entries WHERE id=$1", [entryA],
    )).rows[0].legal_entity_id, null, "no automatic historical payroll attribution");
    assert.deepEqual(await summary(db), moneyBeforeDDL,
      "adding schemas and constraints must never change payroll cents or employee counts");

    const { rows: [{ unvalidated }] } = await db.query(
      "SELECT count(*)::integer AS unvalidated FROM pg_constraint WHERE conname IN (" +
      "'employees_tenant_employer_fk','payroll_runs_tenant_employer_fk'," +
      "'assignment_employee_tenant_fk','transfer_employee_tenant_fk') AND NOT convalidated",
    );
    assert.equal(unvalidated, 4);
    await denied(db,
      "INSERT INTO user_legal_entity_grants(organization_id,user_id,legal_entity_id)" +
      "VALUES($1,$2,$3)", [a, staffA, b1]);
    await denied(db,
      "INSERT INTO user_legal_entity_grants(organization_id,user_id,legal_entity_id)" +
      "VALUES($1,$2,$3)", [a, staffB, a1]);
    await denied(db,
      "INSERT INTO employee_entity_assignments(organization_id,employee_id,legal_entity_id,effective_from)" +
      "VALUES($1,$2,$3,'2026-10-01')", [a, workerA, b1]);
    await denied(db,
      "INSERT INTO employee_entity_assignments(organization_id,employee_id,legal_entity_id,effective_from)" +
      "VALUES($1,$2,$3,'2026-10-01')", [a, workerB, a1]);
    await denied(db, "UPDATE employees SET legal_entity_id=$1 WHERE id=$2", [b1, workerA]);
    await denied(db, "UPDATE payroll_runs SET legal_entity_id=$1 WHERE id=$2", [b1, runA]);

    // A payroll entry explicitly linked to its source run must pin that run's
    // employer, including attempts to change it to another employer in SAME tenant.
    await db.query("UPDATE payroll_entries SET legal_entity_id=$1 WHERE id=$2", [a1, entryA]);
    await denied(db, "UPDATE payroll_runs SET legal_entity_id=$1 WHERE id=$2", [a2, runA]);
    const afterFirst = await summary(db);
    await db.query(sql);
    assert.deepEqual(await summary(db), afterFirst,
      "idempotent DDL replay cannot alter payroll money or worker counts");
    assert.equal(await count(db, "employee_entity_assignments"), 0);
    assert.equal(await count(db, "worker_employment_events"), 0);

    await db.query("ROLLBACK");
    transaction = false;
    assert.deepEqual(await tables(db), initial.tables, "transaction rollback must restore exact catalog");
    assert.deepEqual(await summary(db), initial.totals, "transaction rollback must restore exact ledger");
  } finally {
    if (transaction) await db.query("ROLLBACK").catch(() => {});
    await db.end().catch(() => {});
  }
});
