/**
 * Rollback-only disposable PostgreSQL 16/18 contract rehearsal for the canonical,
 * unmerged 0117, 0118, 0120 migration files.
 *
 * CI-only guard ensures this CANNOT connect to Neon, staging or production.
 * All synthetic test rows and DDL live in a random schema inside a
 * transaction that is always rolled back and verified absent.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
import { assertIsolatedMigrationTarget } from "./lib/isolated-migration-target.mjs";

const { Client } = pg;
const paths = [
  "drizzle/0117_inline_first_payroll_journey.sql",
  "drizzle/0118_wfm_roster_scale_rules.sql",
  "drizzle/0120_wfm_punch_evidence.sql",
];
const schema = "wfm_rehearsal_" + randomBytes(8).toString("hex");
const injected = process.argv.length === 3 && process.argv[2] === "--inject-failure";
const checks = {
  disposableTargetVerified: false,
  syntheticPredecessorsSeeded: false,
  exactSourceMigrationsApplied: false,
  idempotentReplayVerified: false,
  catalogVerified: false,
  tenantForeignKeysVerified: false,
  policyConstraintsVerified: false,
  photoConsentConstraintsVerified: false,
  offlineReviewDefaultsVerified: false,
  rollbackVerified: false,
  injectedFailureVerified: false,
};
const tableNames = [
  "first_payroll_journey_progress",
  "workforce_roster_rule_policies",
  "worksite_punch_policies",
  "workforce_punch_photo_consents",
  "workforce_punch_photo_evidence",
  "workforce_punch_submissions",
];
const indexNames = [
  "first_payroll_journey_tenant_step",
  "wfm_roster_rules_org_idx",
  "wfm_schedule_assignment_effective_window_idx",
  "wfm_worksite_assignment_effective_window_idx",
  "worksite_punch_policies_org_idx",
  "workforce_punch_consent_unique",
  "workforce_punch_photo_expiry_idx",
  "workforce_punch_photo_employee_idx",
  "workforce_punch_client_id_unique",
  "workforce_punch_pending_idx",
  "workforce_punch_signal_idx",
  "workforce_punch_employee_time_idx",
];
let client;
let connected = false;
let transactionOpen = false;

async function rejected(statement, parameters, expectedState) {
  await client.query("SAVEPOINT invalid_record");
  let blocked = false;
  try {
    await client.query(statement, parameters);
  } catch (error) {
    if (error?.code !== expectedState) {
      throw new Error("WFM_REHEARSAL_WRONG_SQLSTATE");
    }
    blocked = true;
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT invalid_record");
    await client.query("RELEASE SAVEPOINT invalid_record");
  }
  assert.ok(blocked, "WFM_REHEARSAL_CONSTRAINT_NOT_ENFORCED");
}

async function seedPredecessors() {
  await client.query([
    "CREATE TABLE organizations (id integer PRIMARY KEY)",
    "CREATE TABLE users (id integer PRIMARY KEY)",
    "CREATE TABLE employees (id integer PRIMARY KEY, organization_id integer NOT NULL REFERENCES organizations(id))",
    "CREATE TABLE worksites (id integer PRIMARY KEY, organization_id integer NOT NULL REFERENCES organizations(id))",
    "CREATE TABLE time_punches (id integer PRIMARY KEY, organization_id integer NOT NULL REFERENCES organizations(id), employee_id integer NOT NULL REFERENCES employees(id))",
    "CREATE TABLE employee_schedule_assignments (id integer PRIMARY KEY, organization_id integer NOT NULL REFERENCES organizations(id), employee_id integer NOT NULL REFERENCES employees(id), effective_from date NOT NULL, effective_until date)",
    "CREATE TABLE employee_worksite_assignments (id integer PRIMARY KEY, organization_id integer NOT NULL REFERENCES organizations(id), employee_id integer NOT NULL REFERENCES employees(id), effective_from date NOT NULL, effective_until date)",
  ].join(";\n") + ";");
  await client.query("INSERT INTO organizations(id) VALUES (1), (2)");
  await client.query("INSERT INTO users(id) VALUES (10), (20)");
  await client.query("INSERT INTO employees(id,organization_id) VALUES (100,1),(200,2)");
  await client.query("INSERT INTO worksites(id,organization_id) VALUES (1000,1),(2000,2)");
  await client.query("INSERT INTO time_punches(id,organization_id,employee_id) VALUES (10000,1,100),(20000,2,200)");
  await client.query("INSERT INTO employee_schedule_assignments(id,organization_id,employee_id,effective_from) VALUES (1,1,100,'2026-10-01'),(2,2,200,'2026-10-01')");
  await client.query("INSERT INTO employee_worksite_assignments(id,organization_id,employee_id,effective_from) VALUES (1,1,100,'2026-10-01'),(2,2,200,'2026-10-01')");
  checks.syntheticPredecessorsSeeded = true;
}

async function verifyObjects() {
  const tables = await client.query(
    "SELECT c.relname AS name FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind IN ('r','p') AND c.relname=ANY($2::text[])",
    [schema, tableNames],
  );
  assert.deepEqual(tables.rows.map(r => r.name).sort(), [...tableNames].sort(),
    "WFM_REHEARSAL_TABLE_CATALOG_MISMATCH");
  const indexes = await client.query(
    "SELECT indexname AS name FROM pg_catalog.pg_indexes WHERE schemaname=$1 AND indexname=ANY($2::text[])",
    [schema, indexNames],
  );
  assert.deepEqual(indexes.rows.map(r => r.name).sort(), [...indexNames].sort(),
    "WFM_REHEARSAL_INDEX_CATALOG_MISMATCH");
  checks.catalogVerified = true;
}

async function verifyBehavior() {
  // Independent employers may have the same journey step; an employer
  // cannot create duplicate steps, invalid stages or non-existent people.
  await client.query(
    "INSERT INTO first_payroll_journey_progress(organization_id,step,owner_role,updated_by_user_id) VALUES (1,'company','owner',10),(2,'company','owner',20)",
  );
  await rejected(
    "INSERT INTO first_payroll_journey_progress(organization_id,step,owner_role,updated_by_user_id) VALUES(1,'company','owner',10)",
    [], "23505",
  );
  await rejected(
    "INSERT INTO first_payroll_journey_progress(organization_id,step,owner_role,updated_by_user_id) VALUES(1,'invalid','owner',10)",
    [], "23514",
  );
  await rejected(
    "INSERT INTO first_payroll_journey_progress(organization_id,step,owner_role,updated_by_user_id) VALUES(999,'company','owner',10)",
    [], "23503",
  );
  checks.tenantForeignKeysVerified = true;

  await client.query(
    "INSERT INTO workforce_roster_rule_policies(organization_id) VALUES (1),(2)",
  );
  const policies = await client.query(
    "SELECT organization_id,active,max_daily_minutes,max_rolling_seven_day_minutes,min_rest_between_shifts_minutes,enforcement_mode FROM workforce_roster_rule_policies ORDER BY organization_id",
  );
  assert.equal(policies.rows.length, 2);
  assert.ok(policies.rows.every(r => r.active && r.max_daily_minutes === 720 &&
    r.max_rolling_seven_day_minutes === 2880 &&
    r.min_rest_between_shifts_minutes === 660 && r.enforcement_mode === "block"));
  await rejected("UPDATE workforce_roster_rule_policies SET max_daily_minutes=120 WHERE organization_id=1", [], "23514");
  await rejected("UPDATE workforce_roster_rule_policies SET enforcement_mode='auto' WHERE organization_id=1", [], "23514");
  await rejected("INSERT INTO workforce_roster_rule_policies(organization_id) VALUES(999)", [], "23503");
  checks.policyConstraintsVerified = true;

  await client.query(
    "INSERT INTO worksite_punch_policies(worksite_id,organization_id,photo_mode,updated_by_user_id) VALUES (1000,1,'optional',10),(2000,2,'off',20)",
  );
  await rejected("UPDATE worksite_punch_policies SET photo_mode='mandatory' WHERE worksite_id=1000", [], "23514");
  await client.query(
    "INSERT INTO workforce_punch_photo_consents(organization_id,employee_id,consent_version,choice,decided_by_user_id) VALUES (1,100,'v1','accepted',10),(2,200,'v1','declined',20)",
  );
  await rejected(
    "INSERT INTO workforce_punch_photo_consents(organization_id,employee_id,consent_version,choice,decided_by_user_id) VALUES (1,100,'v1','declined',10)",
    [], "23505",
  );
  await rejected(
    "UPDATE workforce_punch_photo_consents SET choice='unknown' WHERE employee_id=100",
    [], "23514",
  );
  await client.query(
    "INSERT INTO workforce_punch_photo_evidence(id,organization_id,employee_id,sealed_photo,expires_at) VALUES ('ci-photo-1',1,100,'synthetic-sealed-image','2027-01-01T00:00:00Z')",
  );
  await rejected(
    "INSERT INTO workforce_punch_photo_evidence(id,organization_id,employee_id,expires_at) VALUES ('ci-invalid',1,999,'2027-01-01T00:00:00Z')",
    [], "23503",
  );
  checks.photoConsentConstraintsVerified = true;

  await client.query(
    "INSERT INTO workforce_punch_submissions(organization_id,employee_id,client_punch_id,action_type,work_date,device_occurred_at,received_source,worksite_id,photo_evidence_id,device_digest,requested_by_user_id) VALUES (1,100,'ci-punch-1','clock_in','2026-10-12','2026-10-12T00:00:00Z','offline',1000,'ci-photo-1',$1,10),(2,200,'ci-punch-1','clock_in','2026-10-12','2026-10-12T00:00:00Z','offline',2000,NULL,$2,20)",
    ["a".repeat(64), "b".repeat(64)],
  );
  await rejected(
    "INSERT INTO workforce_punch_submissions(organization_id,employee_id,client_punch_id,action_type,work_date,device_occurred_at,received_source,device_digest,requested_by_user_id) VALUES(1,100,'ci-punch-1','clock_in','2026-10-12','2026-10-12T00:00:00Z','offline',$1,10)",
    ["a".repeat(64)], "23505",
  );
  await rejected("UPDATE workforce_punch_submissions SET status='paid' WHERE organization_id=1", [], "23514");
  await rejected("UPDATE workforce_punch_submissions SET received_source='unknown' WHERE organization_id=1", [], "23514");
  const receipts = await client.query(
    "SELECT organization_id,status,reviewed_by_user_id,time_punch_id,flags FROM workforce_punch_submissions ORDER BY organization_id",
  );
  assert.equal(receipts.rows.length, 2);
  assert.ok(receipts.rows.every(r => r.status === "pending" &&
    r.reviewed_by_user_id === null && r.time_punch_id === null &&
    Array.isArray(r.flags) && r.flags.length === 0));
  checks.offlineReviewDefaultsVerified = true;
}

async function main() {
  const connectionString = assertIsolatedMigrationTarget(process.env);
  const expectedMajor = Number(process.env.WFM_REHEARSAL_PG_MAJOR);
  if (![16, 18].includes(expectedMajor)) {
    throw new Error("WFM_REHEARSAL_PG_MAJOR_MISSING_OR_INVALID");
  }
  if (!(process.argv.length === 2 || injected)) {
    throw new Error("WFM_REHEARSAL_MODE_NOT_RECOGNIZED");
  }
  const source = paths.map(path => ({ path, sql: readFileSync(path, "utf8") }));
  const digest = createHash("sha256");
  for (const migration of source) {
    digest.update(migration.path + "\0");
    digest.update(migration.sql);
    digest.update("\n");
  }
  client = new Client({ connectionString, connectionTimeoutMillis: 5000, query_timeout: 15000 });
  let failed = false;
  try {
    await client.connect();
    connected = true;
    const fingerprint = await client.query(
      "SELECT current_database() AS db, current_user AS role, current_setting('server_version_num')::integer AS version",
    );
    const row = fingerprint.rows[0];
    assert.ok(row?.db === "app_db" && row?.role === "postgres" &&
      row?.version >= expectedMajor * 10000 && row?.version < (expectedMajor + 1) * 10000,
    "WFM_REHEARSAL_DISPOSABLE_PG_IDENTITY_FAILED");
    const existing = await client.query(
      "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','m','f')) OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname NOT IN ('public','pg_catalog','information_schema') AND nspname NOT LIKE 'pg_%') AS occupied",
    );
    assert.equal(existing.rows[0]?.occupied, false,
      "WFM_REHEARSAL_DATABASE_NOT_DISPOSABLE_OR_EMPTY");
    checks.disposableTargetVerified = true;
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query("SET LOCAL statement_timeout = '15000ms'");
    await client.query("SET LOCAL lock_timeout = '2000ms'");
    await client.query('CREATE SCHEMA "' + schema + '"');
    await client.query('SET LOCAL search_path TO "' + schema + '", pg_catalog');
    await seedPredecessors();
    for (const migration of source) await client.query(migration.sql);
    checks.exactSourceMigrationsApplied = true;
    await verifyObjects();
    if (injected) {
      await client.query("CREATE TABLE ci_rollback_probe (id integer PRIMARY KEY)");
      try {
        await client.query(
          "ALTER TABLE ci_rollback_probe ADD CONSTRAINT invalid_relation FOREIGN KEY(id) REFERENCES missing_ci_dependency(id)",
        );
      } catch (error) {
        if (error?.code !== "42P01") throw new Error("WFM_REHEARSAL_WRONG_FAILURE_TYPE");
        checks.injectedFailureVerified = true;
      }
      assert.equal(checks.injectedFailureVerified, true,
        "WFM_REHEARSAL_INTENTIONAL_FAILURE_WAS_NOT_TRIGGERED");
    } else {
      for (const migration of source) await client.query(migration.sql);
      checks.idempotentReplayVerified = true;
      await verifyObjects();
      await verifyBehavior();
    }
  } finally {
    if (transactionOpen && connected) {
      try {
        await client.query("ROLLBACK");
        transactionOpen = false;
      } catch { failed = true; }
    }
    if (connected && !transactionOpen) {
      try {
        const probe = await client.query(
          "SELECT to_regnamespace($1) IS NULL AS absent",
          [schema],
        );
        checks.rollbackVerified = probe.rows[0]?.absent === true;
      } catch { failed = true; }
    }
    if (client) {
      try { await client.end(); } catch { failed = true; }
    }
  }
  const mustPass = injected
    ? ["disposableTargetVerified","syntheticPredecessorsSeeded","exactSourceMigrationsApplied",
      "catalogVerified","rollbackVerified","injectedFailureVerified"]
    : Object.keys(checks).filter(k => k !== "injectedFailureVerified");
  if (failed || mustPass.some(k => checks[k] !== true)) {
    throw new Error("WFM_REHEARSAL_INCOMPLETE");
  }
  mkdirSync("qa-artifacts", { recursive: true });
  const path = injected
    ? "qa-artifacts/wfm-migration-injected-failure.json"
    : "qa-artifacts/wfm-migration-synthetic-rehearsal.json";
  writeFileSync(path, JSON.stringify({
    schemaVersion: 1,
    kind: injected ? "wfm-synthetic-sql-failure-rollback" : "wfm-synthetic-migration-contract",
    sourceFiles: paths,
    sourceDigest: digest.digest("hex"),
    ...checks,
    mode: "isolated-ci-only",
    postgresMajor: expectedMajor,
    syntheticRowsOnly: true,
    realEmployerDataAccessed: false,
    productionCloneRehearsed: false,
    actualNeonBranchAltered: false,
    productionReleaseApproved: false,
    databaseChangesCommitted: false,
  }, null, 2) + "\n");
  console.log(injected
    ? `WFM migration injected-failure rollback verified on synthetic PostgreSQL ${expectedMajor}.`
    : `WFM 0117+0118+0120 synthetic contract and rollback rehearsal verified on PostgreSQL ${expectedMajor}.`);
}

await main().catch(() => {
  console.error("WFM_MIGRATION_CONTRACT_REHEARSAL_FAILED; no external database was accessed.");
  process.exitCode = 1;
});
