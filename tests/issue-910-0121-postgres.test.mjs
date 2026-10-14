import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import pg from "pg";
import { assertIsolatedMigrationTarget } from "../scripts/lib/isolated-migration-target.mjs";

/**
 * #910: executable 0121 rehearsal on a disposable, GitHub-hosted PostgreSQL
 * fixture. NEVER pass a Neon production, clone or employer database URL.
 *
 * The SQL stages under docs/sql are review extracts, not release migrations.
 */
const REHEARSAL = process.env.CI === "true" &&
  process.env.GITHUB_ACTIONS === "true" &&
  process.env.ISSUE_910_REHEARSAL === "isolated-ci-only";
const SQL = readFileSync(
  new URL("../drizzle/0121_multi_entity_v2_scope_transfer.sql", import.meta.url), "utf8");
const stage = name => readFileSync(
  new URL("../docs/sql/issue-910-review-only-0121-" + name + ".sql", import.meta.url), "utf8")
  .split("-- BEGIN_SOURCE_0121_STAGE --\n")[1]
  ?.split("-- END_SOURCE_0121_STAGE --")[0]?.trim() ?? "";

function url() {
  return assertIsolatedMigrationTarget({
    ...process.env,
    MIGRATION_REHEARSAL_MODE: process.env.ISSUE_910_REHEARSAL,
  });
}
async function counts(client) {
  const { rows: [v] } = await client.query(
    "SELECT (SELECT count(*)::int FROM organizations) AS organizations, " +
    "(SELECT count(*)::int FROM employees) AS employees, " +
    "(SELECT count(*)::int FROM payroll_runs) AS runs, " +
    "(SELECT count(*)::int FROM payroll_entries) AS entries");
  return v;
}
async function catalog(client) {
  const { rows } = await client.query(
    "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace " +
    "WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY relname");
  return rows.map(x => x.relname);
}
async function one(client, text, args = []) {
  const { rows } = await client.query(text, args);
  assert.equal(rows.length, 1);
  return rows[0];
}
async function rejectSql(client, sql, args = [], errorCode = "23503") {
  await client.query("SAVEPOINT negative");
  await assert.rejects(() => client.query(sql, args), e => e.code === errorCode,
    "database must fail closed on cross-tenant or cross-entity writes");
  await client.query("ROLLBACK TO SAVEPOINT negative");
  await client.query("RELEASE SAVEPOINT negative");
}

test("#910: missing historical table does not prevent additive 0121 schema stage, including retry", {
  skip: !REHEARSAL, timeout: 120000,
}, async () => {
  const client = new pg.Client({ connectionString: url(), connectionTimeoutMillis: 5000 });
  await client.connect();
  let transaction = false;
  try {
    const before = { counts: await counts(client), catalog: await catalog(client) };
    await client.query("BEGIN");
    transaction = true;
    // Only in disposable CI: recreate the live missing 0050-table condition.
    await client.query("DROP TABLE IF EXISTS public.worker_employment_events CASCADE");
    const gone = await one(client,
      "SELECT to_regclass('public.worker_employment_events') IS NULL AS gone");
    assert.equal(gone.gone, true);
    const schemaOnly = stage("schema");
    assert.match(schemaOnly, /CREATE TABLE IF NOT EXISTS employee_entity_assignments/);
    assert.doesNotMatch(schemaOnly, /\b(?:INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM)\b/i);
    await client.query(schemaOnly);
    await client.query(schemaOnly);
    const provisioned = await one(client,
      "SELECT to_regclass('public.user_legal_entity_grants') IS NOT NULL AS grants, " +
      "to_regclass('public.employee_entity_assignments') IS NOT NULL AS assignments, " +
      "to_regclass('public.entity_transfer_requests') IS NOT NULL AS transfers");
    assert.deepEqual(provisioned, { grants: true, assignments: true, transfers: true });
    assert.deepEqual(await counts(client), before.counts);
    await client.query("ROLLBACK");
    transaction = false;
    assert.deepEqual(await catalog(client), before.catalog);
    assert.deepEqual(await counts(client), before.counts);
  } finally {
    if (transaction) await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
});

test("#910: 0121 backfill uses immutable run employer, excludes ambiguous history, retries and rolls back", {
  skip: !REHEARSAL, timeout: 120000,
}, async () => {
  const client = new pg.Client({ connectionString: url(), connectionTimeoutMillis: 5000 });
  await client.connect();
  let transaction = false;
  try {
    const before = { counts: await counts(client), catalog: await catalog(client) };
    await client.query("BEGIN");
    transaction = true;
    const [a,b,c] = (await client.query(
      "INSERT INTO organizations(name,legal_name) VALUES " +
      "('Issue910A','Issue910A'),('Issue910B','Issue910B'),('Issue910C','Issue910C') RETURNING id"
    )).rows.map(x => x.id);
    const [a1,a2,b1] = (await client.query(
      "INSERT INTO legal_entities(organization_id,code,legal_name,display_name,primary_entity) VALUES " +
      "($1,'A1','A1','A1',true),($1,'A2','A2','A2',false),($2,'B1','B1','B1',true) RETURNING id",
      [a,b])).rows.map(x => x.id);
    const [hr] = (await client.query(
      "INSERT INTO users(name,email,password_hash,role) " +
      "VALUES ('Synthetic HR','issue910.hr@example.test','synthetic','hr') RETURNING id"
    )).rows.map(x => x.id);
    await client.query(
      "INSERT INTO user_organizations(organization_id,user_id,role) VALUES ($1,$2,'hr')",
      [a,hr]);
    const [worker1,workerMoved,workerTransferred,workerB] = (await client.query(
      "INSERT INTO employees(organization_id,legal_entity_id,employee_no,first_name,last_name,title," +
      "avatar_initials,basic_rate,start_date) VALUES " +
      "($1,$2,'A1','Synthetic','WorkerA1','Staff','AA',20000,'2026-01-01')," +
      "($1,$3,'A2','Synthetic','WorkerA2','Staff','AB',30000,'2025-01-01')," +
      "($1,$3,'A3','Synthetic','WorkerA3','Staff','AC',35000,'2025-01-01')," +
      "($4,$5,'B1','Synthetic','WorkerB','Staff','BA',24000,'2026-01-01') RETURNING id",
      [a,a1,a2,b,b1])).rows.map(x=>x.id);
    // A third worker has an explicitly recorded transfer; never infer an
    // unbroken single-employer interval for that person.
    await client.query(
      "INSERT INTO worker_employment_events " +
      "(organization_id,employee_id,effective_date,event_type,from_legal_entity_id,to_legal_entity_id,reason)" +
      " VALUES($1,$2,'2026-06-01','entity_transfer',$3,$4,'Synthetic historic move')",
      [a,workerTransferred,a1,a2]);
    const [runA,runB] = (await client.query(
      "INSERT INTO payroll_runs(organization_id,legal_entity_id,period_label,period_start,period_end,pay_date) " +
      "VALUES($1,$2,'Jan A','2026-01-01','2026-01-15','2026-01-15')," +
      "($3,$4,'Jan B','2026-01-01','2026-01-15','2026-01-15') RETURNING id",
      [a,a1,b,b1])).rows.map(x=>x.id);
    const [entryA,entryOld,entryB] = (await client.query(
      "INSERT INTO payroll_entries(payroll_run_id,employee_id,gross_pay,deductions,net_pay) VALUES " +
      "($1,$2,20000,1000,19000),($1,$3,10000,500,9500),($4,$5,24000,2000,22000) " +
      "RETURNING id", [runA,worker1,workerMoved,runB,workerB]
    )).rows.map(x => x.id);
    await client.query(
      "INSERT INTO payslips(payroll_entry_id,organization_id,employee_id,period_label,content) VALUES " +
      "($1,$2,$3,'Jan A','fictional'),($4,$5,$6,'Jan B','fictional')",
      [entryA,a,worker1,entryB,b,workerB]);
    await client.query("INSERT INTO payroll_jobs(organization_id,payroll_run_id) VALUES($1,$2),($3,$4)",
      [a,runA,b,runB]);
    const moneyBefore = await one(client,
      "SELECT COALESCE(sum(gross_pay),0)::numeric(20,2)::text AS gross, " +
      "COALESCE(sum(net_pay),0)::numeric(20,2)::text AS net FROM payroll_entries");
    assert.equal(moneyBefore.gross,"54000.00");
    assert.equal(moneyBefore.net,"50500.00");
    await client.query(SQL);
    // This independently reviewable candidate is not part of the original
    // historical source; NEVER assume 0121 alone enforces these tenant FKs.
    const tenantGuard = readFileSync(new URL(
      "../docs/sql/issue-910-review-only-post-0121-tenant-integrity.sql", import.meta.url), "utf8");
    await client.query(tenantGuard);
    await client.query(tenantGuard);
    const integrity = await one(client,
      "SELECT count(*)::int AS count FROM pg_constraint WHERE conname IN (" +
      "'employees_tenant_employer_fk','payroll_runs_tenant_employer_fk'," +
      "'assignment_employee_tenant_fk','transfer_employee_tenant_fk'," +
      "'entity_grant_membership_tenant_fk','entity_preference_membership_tenant_fk'," +
      "'payroll_entries_run_employer_fk','payslips_entry_employer_fk'," +
      "'payroll_jobs_run_employer_fk','payout_batches_run_employer_fk'," +
      "'payout_transfers_run_employer_fk','bank_file_validations_run_employer_fk'," +
      "'year_end_adjustments_run_employer_fk')");
    assert.equal(integrity.count, 13);
    // The source proposal deliberately leaves legacy FKs unvalidated.
    // The disposable db:push fixture already creates the two employee/transfer
    // tenant FKs declared in src/db/schema.ts, and those are VALIDATED.
    // The post-0121 review-only SQL creates the two legacy employer FKs as
    // NOT VALID (guard NEW writes without claiming historical row validation).
    // Requiring all four to be unvalidated would reject stronger constraints.
    const fourGuards = await client.query(
      "SELECT conname, convalidated, contype FROM pg_constraint WHERE conname = ANY($1::text[])",
      [[
        "employees_tenant_employer_fk", "payroll_runs_tenant_employer_fk",
        "assignment_employee_tenant_fk", "transfer_employee_tenant_fk",
      ]],
    );
    assert.equal(fourGuards.rows.length, 4);
    const guardByName = new Map(fourGuards.rows.map(row => [row.conname, row]));
    for (const name of ["employees_tenant_employer_fk", "payroll_runs_tenant_employer_fk"]) {
      assert.equal(guardByName.get(name)?.contype, "f", name);
      assert.equal(guardByName.get(name)?.convalidated, false,
        name + ": do not invent historical entity validation");
    }
    for (const name of ["assignment_employee_tenant_fk", "transfer_employee_tenant_fk"]) {
      assert.equal(guardByName.get(name)?.contype, "f", name);
      assert.equal(guardByName.get(name)?.convalidated, true,
        name + ": present schema-declared tenant FK must stay validated");
    }
    const assigned = await client.query(
      "SELECT e.id,r.legal_entity_id AS expected,e.legal_entity_id AS actual " +
      "FROM payroll_entries e JOIN payroll_runs r ON r.id=e.payroll_run_id ORDER BY e.id");
    for (const row of assigned.rows) assert.equal(row.actual,row.expected);
    const payslipScope=await one(client,
      "SELECT count(*)::int AS bad FROM payslips p JOIN payroll_entries e ON e.id=p.payroll_entry_id " +
      "WHERE p.legal_entity_id IS DISTINCT FROM e.legal_entity_id");
    assert.equal(payslipScope.bad,0);
    const jobScope=await one(client,
      "SELECT count(*)::int AS bad FROM payroll_jobs j JOIN payroll_runs r ON r.id=j.payroll_run_id " +
      "WHERE j.legal_entity_id IS DISTINCT FROM r.legal_entity_id");
    assert.equal(jobScope.bad,0);
    const primaryC=await one(client,
      "SELECT count(*)::int AS count FROM legal_entities WHERE organization_id=$1 AND primary_entity=true",[c]);
    assert.equal(primaryC.count,1);
    const assignments=await client.query(
      "SELECT employee_id,legal_entity_id,effective_from::text AS start " +
      "FROM employee_entity_assignments WHERE employee_id=ANY($1::int[]) ORDER BY employee_id",
      [[worker1,workerMoved,workerTransferred,workerB]]);
    assert.deepEqual(assignments.rows.map(row=>row.employee_id).sort((x,y)=>x-y),
      [worker1,workerB].sort((x,y)=>x-y),
      "known historical cross-employer earnings or transfer must block inferred interval");
    assert.equal(assignments.rows.find(row=>row.employee_id===worker1)?.legal_entity_id,a1);
    assert.equal(assignments.rows.find(row=>row.employee_id===workerB)?.legal_entity_id,b1);
    const groupGrant=await one(client,
      "SELECT count(*)::int AS count FROM user_legal_entity_grants WHERE organization_id=$1 AND user_id=$2 AND legal_entity_id=$3",
      [a,hr,a1]);
    assert.equal(groupGrant.count,1);
    await rejectSql(client,
      "INSERT INTO user_legal_entity_grants(organization_id,user_id,legal_entity_id) VALUES($1,$2,$3)",
      [a,hr,b1]);
    const foreignUser=await one(client,
      "INSERT INTO users(name,email,password_hash,role) " +
      "VALUES('Foreign synthetic','issue910.foreign@example.test','synthetic','hr') RETURNING id");
    await client.query(
      "INSERT INTO user_organizations(organization_id,user_id,role) VALUES($1,$2,'hr')",
      [b,foreignUser.id]);
    await rejectSql(client,
      "INSERT INTO user_legal_entity_grants(organization_id,user_id,legal_entity_id) VALUES($1,$2,$3)",
      [a,foreignUser.id,a1]);
    await rejectSql(client,
      "INSERT INTO employee_entity_assignments(organization_id,employee_id,legal_entity_id,effective_from) " +
      "VALUES($1,$2,$3,'2026-04-01')",[a,workerB,a1]);
    await rejectSql(client,
      "INSERT INTO entity_transfer_requests(organization_id,employee_id,from_legal_entity_id," +
      "to_legal_entity_id,effective_date,reason,service_start_date,continuity_note,requested_by_user_id)" +
      " VALUES($1,$2,$3,$4,'2026-11-01','Foreign worker','2026-01-01','None',$5)",
      [a,workerB,a1,a2,hr]);
    await rejectSql(client,
      "UPDATE employees SET legal_entity_id=$1 WHERE id=$2", [b1,worker1]);
    await rejectSql(client,
      "UPDATE payroll_runs SET legal_entity_id=$1 WHERE id=$2", [b1,runA]);
    await rejectSql(client,
      "UPDATE payroll_entries SET legal_entity_id=$1 WHERE id=$2", [b1,entryA]);
    await rejectSql(client,
      "UPDATE payslips SET legal_entity_id=$1 WHERE payroll_entry_id=$2", [b1,entryA]);
    // A newly enrolled B HR member was intentionally created AFTER the first
    // pass. One additional legitimate B grant is expected on the next pass;
    // it is not a duplicate of the existing A grant.
    const sizesBeforeEnrollment=await one(client,
      "SELECT (SELECT count(*)::int FROM employee_entity_assignments) AS assignments, " +
      "(SELECT count(*)::int FROM user_legal_entity_grants) AS grants, " +
      "(SELECT count(*)::int FROM legal_entities) AS entities");
    await client.query(SQL);
    const enrolledGrant=await one(client,
      "SELECT count(*)::int AS count FROM user_legal_entity_grants WHERE organization_id=$1 " +
      "AND user_id=$2 AND legal_entity_id=$3",[b,foreignUser.id,b1]);
    assert.equal(enrolledGrant.count,1);
    const sizesAfterEnrollment=await one(client,
      "SELECT (SELECT count(*)::int FROM employee_entity_assignments) AS assignments, " +
      "(SELECT count(*)::int FROM user_legal_entity_grants) AS grants, " +
      "(SELECT count(*)::int FROM legal_entities) AS entities");
    assert.equal(sizesAfterEnrollment.grants,sizesBeforeEnrollment.grants+1);
    assert.equal(sizesAfterEnrollment.assignments,sizesBeforeEnrollment.assignments);
    assert.equal(sizesAfterEnrollment.entities,sizesBeforeEnrollment.entities);
    // A retry with no further membership changes must be fully idempotent.
    await client.query(SQL);
    assert.deepEqual(await one(client,
      "SELECT (SELECT count(*)::int FROM employee_entity_assignments) AS assignments, " +
      "(SELECT count(*)::int FROM user_legal_entity_grants) AS grants, " +
      "(SELECT count(*)::int FROM legal_entities) AS entities"),sizesAfterEnrollment);
    assert.deepEqual(await one(client,
      "SELECT COALESCE(sum(gross_pay),0)::numeric(20,2)::text AS gross," +
      " COALESCE(sum(net_pay),0)::numeric(20,2)::text AS net FROM payroll_entries"),moneyBefore);
    // Source employee service dates survive. No final pay or statutory artifact is created.
    assert.equal((await one(client,"SELECT start_date::text AS date FROM employees WHERE id=$1",[workerMoved])).date,
      "2025-01-01");
    assert.equal((await one(client,"SELECT legal_entity_id AS id FROM employees WHERE id=$1",[workerMoved])).id,a2);
    assert.equal((await one(client,"SELECT count(*)::int AS count FROM entity_transfer_requests")).count,0);
    await client.query("ROLLBACK");
    transaction=false;
    assert.deepEqual(await catalog(client),before.catalog);
    assert.deepEqual(await counts(client),before.counts);
  } finally {
    if(transaction) await client.query("ROLLBACK").catch(()=>{});
    await client.end().catch(()=>{});
  }
});
