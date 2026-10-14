import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

/**
 * Rehearse the EXACT unnumbered offline-claims SQL in a disposable PG16/18
 * transaction. Its target table lives in a throwaway schema, while references
 * resolve to the real schema-first public employees, users and organizations.
 * The final ROLLBACK removes the schema, records and ALL synthetic parents.
 * This is not a numbered migration or production approval.
 */
assert.equal(process.env.CI, "true");
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.OFFLINE_CLAIM_MIGRATION_REHEARSAL_MODE, "isolated-ci-only");
const dbUrl = new URL(process.env.DATABASE_URL ?? "");
assert.equal(dbUrl.protocol, "postgresql:");
assert.equal(dbUrl.hostname, "127.0.0.1");
assert.equal(dbUrl.port, "5432");
assert.equal(dbUrl.pathname, "/app_db");
assert.equal(dbUrl.username, "postgres");
for (const name of ["PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED"])
  assert.notEqual(process.env[name], "true", "Money movement must remain disabled");
assert.notEqual(process.env.FACE_OFFLINE_PUNCH_UI_ENABLED, "true",
  "The SQL rehearsal does not activate the offline feature");

const path = new URL("../../docs/engineering/migration-proposals/offline-punch-claims.sql", import.meta.url);
const sql = readFileSync(path, "utf8");
assert.ok(sql.startsWith("-- UNNUMBERED PROPOSAL / NOT FOR PRODUCTION."));
const digest = createHash("sha256").update(sql).digest("hex");
const suffix = randomBytes(6).toString("hex");
const schema = "offline_claim_qa_" + suffix;
const tables = ["organizations", "employees", "users", "offline_punch_claims", "time_punches", "payroll_runs"];
const checks = [];
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
let began = false;
let connected = false;
let failure = "none";
let outcome = "BLOCKED";
const rowCounts = async () => {
  const result = {};
  for (const table of tables) {
    const { rows } = await client.query("SELECT count(*)::int AS count FROM public." + table);
    result[table] = rows[0].count;
  }
  return result;
};
async function expectSqlRejection(label, statement, params, sqlState) {
  await client.query("SAVEPOINT expected_denial");
  try {
    await assert.rejects(() => client.query(statement, params), err =>
      err?.code === sqlState, label + " must fail with SQLSTATE " + sqlState);
    checks.push(label);
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT expected_denial");
    await client.query("RELEASE SAVEPOINT expected_denial");
  }
}

try {
  await client.connect();
  connected = true;
  for (const table of tables) {
    const { rows } = await client.query("SELECT to_regclass($1) AS present", ["public." + table]);
    assert.ok(rows[0].present, "Schema-first fixture table missing: " + table);
  }
  const baseline = await rowCounts();
  assert.ok(Object.values(baseline).every(count => count === 0),
    "Refuse rehearsal on a populated database, even one with synthetic-looking entries");

  await client.query("BEGIN");
  began = true;
  await client.query("SET LOCAL statement_timeout = '10000ms'");
  await client.query('CREATE SCHEMA "' + schema + '"');
  await client.query('SET LOCAL search_path TO "' + schema + '", public');
  await client.query(sql); // proposal's actual bytes, not a recreated Drizzle table

  const catalog = await client.query(
    "SELECT conname FROM pg_constraint WHERE conrelid=$1::regclass",
    [schema + ".offline_punch_claims"],
  );
  const names = new Set(catalog.rows.map(row => row.conname));
  for (const name of ["workflow_offline_employee_tenant_fk", "offline_punch_client_event_unique",
    "offline_claim_action_type_check", "offline_claim_status_check"]) {
    assert.ok(names.has(name), "Exact proposal omitted constraint: " + name);
  }
  const parent = await client.query(
    "SELECT confrelid::regclass::text AS referenced FROM pg_constraint " +
    "WHERE conrelid=$1::regclass AND conname='workflow_offline_employee_tenant_fk'",
    [schema + ".offline_punch_claims"],
  );
  assert.equal(parent.rows[0]?.referenced, "employees",
    "Composite tenant FK must refer to the schema-first parent relation");
  checks.push("exact SQL parsed against existing public parent tables and FK catalog");
  const columns = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='offline_punch_claims'",
    [schema],
  );
  assert.ok(!columns.rows.some(row => /photo|face|biometric|salary|account/i.test(row.column_name)),
    "Unverified claim table must never introduce biometric/payroll data");
  checks.push("no biometric or salary columns");

  const employer = async name => (await client.query(
    "INSERT INTO public.organizations(name,legal_name) VALUES($1,$1) RETURNING id",
    ["Fictional offline employer " + suffix + name],
  )).rows[0].id;
  const orgA = await employer("A");
  const orgB = await employer("B");
  const employee = async (organizationId, code) => (await client.query(
    "INSERT INTO public.employees(organization_id,employee_no,first_name,last_name,title,avatar_initials,basic_rate,start_date) " +
      "VALUES($1,$2,'Fictional','Employee','Synthetic QA','FE','10000.00','2026-01-01') RETURNING id",
    [organizationId, "QA-" + suffix + code],
  )).rows[0].id;
  const empA = await employee(orgA, "A");
  const empB = await employee(orgB, "B");
  const actor = (await client.query(
    "INSERT INTO public.users(name,email,password_hash,role) VALUES('Fictional offline actor',$1,'qa-only','employee') RETURNING id",
    ["offline-" + suffix + "@example.test"],
  )).rows[0].id;
  async function claim(org, worker, event, action = "clock_in", status = "pending_review") {
    return client.query(
      "INSERT INTO offline_punch_claims(organization_id,employee_id,submitted_by_user_id,client_event_id,claimed_at,action_type,status) " +
      "VALUES($1,$2,$3,$4,now()-interval '3 minutes',$5,$6) RETURNING id",
      [org, worker, actor, event, action, status],
    );
  }
  const event = "qa-" + suffix;
  const result = await claim(orgA, empA, event);
  assert.equal(result.rowCount, 1);
  const id = result.rows[0].id;
  checks.push("fictional same-employer insert");
  await expectSqlRejection("same-employee client event is unique", 
    "INSERT INTO offline_punch_claims(organization_id,employee_id,submitted_by_user_id,client_event_id,claimed_at,action_type) VALUES($1,$2,$3,$4,now(),'clock_in')",
    [orgA, empA, actor, event], "23505");
  await expectSqlRejection("employer A cannot claim employer B employee",
    "INSERT INTO offline_punch_claims(organization_id,employee_id,submitted_by_user_id,client_event_id,claimed_at,action_type) VALUES($1,$2,$3,'cross-a',now(),'clock_in')",
    [orgA, empB, actor], "23503");
  await expectSqlRejection("employer B cannot claim employer A employee",
    "INSERT INTO offline_punch_claims(organization_id,employee_id,submitted_by_user_id,client_event_id,claimed_at,action_type) VALUES($1,$2,$3,'cross-b',now(),'clock_in')",
    [orgB, empA, actor], "23503");
  await expectSqlRejection("invalid action rejected",
    "UPDATE offline_punch_claims SET action_type='break_start' WHERE id=$1", [id], "23514");
  await expectSqlRejection("fake payroll approval rejected",
    "UPDATE offline_punch_claims SET status='approved' WHERE id=$1", [id], "23514");
  const reviewed = await client.query(
    "UPDATE offline_punch_claims SET status='flagged',reviewed_by_user_id=$1,review_note='Synthetic HR correction only',reviewed_at=now() WHERE id=$2 RETURNING status",
    [actor,id],
  );
  assert.equal(reviewed.rows[0]?.status, "flagged");
  checks.push("status is unverified/flagged; no automatic approval");

  // SQL is a single-use proposal, not idempotent CREATE TABLE IF NOT EXISTS.
  // Reapplication without a migration ledger must fail without damaging the baseline.
  await expectSqlRejection("duplicate proposal cannot silently reapply",sql,[], "42P07");
  const during = await rowCounts();
  for (const table of ["time_punches", "payroll_runs"]) {
    assert.equal(during[table], baseline[table], "No authoritative ledger writes");
  }
  checks.push("no time-punch or payroll writes");
  outcome = "PASS";
} catch (error) {
  failure = typeof error?.code === "string" ? error.code : "REHEARSAL_ASSERTION_FAILED";
  throw error;
} finally {
  if (connected) {
    if (began) await client.query("ROLLBACK");
    const leftovers = await client.query(
      "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=$1) AS exists",
      [schema],
    );
    assert.equal(leftovers.rows[0].exists,false,"Rollback left a rehearsal schema");
    const after = await rowCounts();
    assert.ok(Object.values(after).every(count => count === 0),
      "Rollback changed public schema-first fixture rows");
    await client.end();
  }
  mkdirSync("qa-artifacts", { recursive: true });
  writeFileSync("qa-artifacts/offline-claim-proposal-rehearsal.json",
    JSON.stringify({
      sourceSha: process.env.PR_HEAD_SHA ?? process.env.GITHUB_SHA ?? "local",
      githubRunId: process.env.GITHUB_RUN_ID ?? "local",
      kind: "offline-claim-exact-proposal-disposable-rollback",
      database: "isolated-localhost-PostgreSQL",
      sqlSha256: digest,
      result: outcome,
      failureCode: failure,
      negativeTests: checks,
      changesCommitted: false,
      productionDatabaseAccess: false,
      physicalDeviceUat: "NOT_RUN",
      independentHumanAcceptance: "NOT_RUN",
      operationalActivation: "PROHIBITED",
    }, null, 2) + "\n");
}
if (outcome !== "PASS") process.exitCode = 1;
else console.log("PASS: exact offline claim proposal, tenant constraints and full transactional rollback");
