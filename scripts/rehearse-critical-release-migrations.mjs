/**
 * Critical release migration bundle rehearsal. Only the disposable Postgres 16
 * GitHub Actions service is accepted. This is NOT a production clone, full
 * historical migration replay, or approval to run SQL against a real employer.
 *
 * The chosen 0100/0106/0109/0110 DDL runs twice against minimal synthetic
 * predecessor tables inside ONE transaction; that transaction is always
 * rolled back and its schema absence is verified afterward.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
import { assertIsolatedMigrationTarget } from "./lib/isolated-migration-target.mjs";
import {
  evaluateReleaseSchemaInventory,
  releaseIndexCatalogSql,
  requiredReleaseColumns,
  requiredReleaseIndexes,
  requiredReleaseTables,
  validatedReleaseIndexes,
} from "../src/lib/production-schema-inventory.ts";

const { Client } = pg;
const migrations = [
  "drizzle/0100_compensation_automation_intents.sql",
  "drizzle/0106_saas_selfserve_recurring_billing.sql",
  "drizzle/0109_tamper_evident_audit_chain.sql",
  "drizzle/0110_provider_events_inbox.sql",
];

const syntheticBankMarker = "SYNTHETIC-NOT-A-REAL-BANK-ACCOUNT";
const schema = "release_qa_" + randomBytes(8).toString("hex");
const accepted = {
  releaseObjectsVerified: false,
  uniqueConstraintsVerified: false,
  auditProtectionVerified: false,
  syntheticBankFieldPreserved: false,
  migrationsReplayedTwice: false,
  rollbackVerified: false,
};
const digest = createHash("sha256");
let client;
let transactionOpen = false;
let connected = false;
let failed = false;

async function assertExpectedFailure(statement, parameters, sqlState) {
  await client.query("SAVEPOINT rejected_probe");
  let rejected = false;
  try {
    await client.query(statement, parameters);
  } catch (error) {
    if (error?.code !== sqlState) {
      throw new Error("REHEARSAL_UNEXPECTED_SQLSTATE");
    }
    rejected = true;
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT rejected_probe");
    await client.query("RELEASE SAVEPOINT rejected_probe");
  }
  assert.ok(rejected, "REHEARSAL_CONSTRAINT_DID_NOT_REJECT_INVALID_RECORD");
}

async function inspectReleaseObjects() {
  const tables = await client.query(
    "SELECT c.relname AS name FROM pg_catalog.pg_class c " +
    "JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace " +
    "WHERE n.nspname = $1 AND c.relkind IN ('r','p') " +
    "AND c.relname = ANY($2::text[])",
    [schema, [...requiredReleaseTables]],
  );
  const columns = await client.query(
    "SELECT c.relname || '.' || a.attname AS name FROM pg_catalog.pg_attribute a " +
    "JOIN pg_catalog.pg_class c ON c.oid = a.attrelid " +
    "JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace " +
    "WHERE n.nspname = $1 AND c.relkind IN ('r','p') " +
    "AND a.attnum > 0 AND NOT a.attisdropped " +
    "AND (c.relname || '.' || a.attname) = ANY($2::text[])",
    [schema, [...requiredReleaseColumns]],
  );
  const indexes = await client.query(releaseIndexCatalogSql, [
    [...requiredReleaseIndexes], schema,
  ]);
  const seal = await client.query(
    "SELECT to_regprocedure($1::text) IS NOT NULL AS present",
    [schema + ".seal_audit_events(integer)"],
  );
  const triggers = await client.query(
    "SELECT c.relname || '.' || t.tgname AS name " +
    "FROM pg_catalog.pg_trigger t " +
    "JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid " +
    "JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace " +
    "WHERE n.nspname = $1 AND c.relname = 'audit_events' " +
    "AND t.tgname = 'audit_events_protect_mutation' " +
    "AND NOT t.tgisinternal AND t.tgenabled IN ('O','A') " +
    "AND (t.tgtype & 27) = 27 " +
    "AND t.tgfoid = to_regprocedure($2::text)",
    [schema, schema + ".audit_events_protect()"],
  );
  const outcome = evaluateReleaseSchemaInventory({
    tables: tables.rows.map(row => row.name),
    columns: columns.rows.map(row => row.name),
    indexes: validatedReleaseIndexes(indexes.rows),
    functions: seal.rows[0]?.present ? ["seal_audit_events(integer)"] : [],
    triggers: triggers.rows.map(row => row.name),
  });
  assert.equal(outcome.schemaCompatible, true,
    "REHEARSAL_RELEASE_SCHEMA_SIGNATURE_MISMATCH");
}

async function seedSyntheticPredecessors() {
  // Minimal synthetic pre-cutover schema, not an export or copy of an employer.
  // Parent tables contain only the columns used by the reviewed four migrations.
  await client.query([
    "CREATE TABLE organizations (id integer PRIMARY KEY)",
    "CREATE TABLE users (id integer PRIMARY KEY)",
    "CREATE TABLE employees (id integer PRIMARY KEY, organization_id integer REFERENCES organizations(id), bank_account varchar(160))",
    "CREATE TABLE payroll_runs (id integer PRIMARY KEY, organization_id integer REFERENCES organizations(id))",
    "CREATE TABLE payroll_entries (id integer PRIMARY KEY, payroll_run_id integer REFERENCES payroll_runs(id), trace jsonb)",
    "CREATE TABLE compensation_events (id integer PRIMARY KEY, organization_id integer REFERENCES organizations(id), employee_id integer REFERENCES employees(id))",
    "CREATE TABLE subscriptions (id integer PRIMARY KEY, organization_id integer REFERENCES organizations(id))",
    "CREATE TABLE audit_events (id serial PRIMARY KEY, organization_id integer, actor text NOT NULL, action text NOT NULL, resource text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now())",
  ].join(";\n") + ";");
  await client.query("INSERT INTO organizations (id) VALUES (1),(2)");
  await client.query("INSERT INTO users (id) VALUES (101),(102)");
  await client.query(
    "INSERT INTO employees (id, organization_id, bank_account) VALUES (301, 1, $1), (302, 2, NULL)",
    [syntheticBankMarker],
  );
  await client.query("INSERT INTO compensation_events (id, organization_id, employee_id) VALUES (501, 1, 301)");
  await client.query("INSERT INTO subscriptions (id, organization_id) VALUES (1001, 1),(1002, 2)");
  await client.query("INSERT INTO payroll_runs (id, organization_id) VALUES (701, 1),(702, 2)");
  await client.query(
    "INSERT INTO audit_events (organization_id, actor, action, resource, metadata) " +
    "VALUES (1, 'CI actor', 'pre-migration', 'synthetic', '{\"kind\":\"CI\"}'::jsonb)",
  );
}

async function exerciseConstraintsAndAudit() {
  await client.query(
    "INSERT INTO compensation_automation_intents " +
    "(organization_id, employee_id, compensation_event_id, \"trigger\", event_key) " +
    "VALUES (1, 301, 501, 'compensation.approved', 'CI-SYNTHETIC-EVENT')",
  );
  await assertExpectedFailure(
    "INSERT INTO compensation_automation_intents " +
      "(organization_id, employee_id, compensation_event_id, \"trigger\", event_key) " +
      "VALUES (1, 301, 501, 'compensation.approved', 'CI-SYNTHETIC-EVENT')",
    [], "23505",
  );

  await client.query(
    "INSERT INTO saas_billing_checkouts " +
      "(organization_id, subscription_id, reference_id, plan, seats, amount_cents) " +
      "VALUES (1, 1001, 'CI-ONE', 'Core', 3, 25000)",
  );
  await assertExpectedFailure(
    "INSERT INTO saas_billing_checkouts " +
      "(organization_id, subscription_id, reference_id, plan, seats, amount_cents) " +
      "VALUES (1, 1001, 'CI-TWO', 'Core', 3, 25000)",
    [], "23505",
  );
  // Independent synthetic employers are allowed their own active checkout.
  await client.query(
    "INSERT INTO saas_billing_checkouts " +
      "(organization_id, subscription_id, reference_id, plan, seats, amount_cents) " +
      "VALUES (2, 1002, 'CI-THREE', 'Core', 2, 25000)",
  );

  await client.query(
    "INSERT INTO provider_events (provider, event_id, organization_id, payroll_run_id, event_type) " +
    "VALUES ('paymongo', 'SYNTHETIC-EVENT', 1, 701, 'transfer.updated')",
  );
  await assertExpectedFailure(
    "INSERT INTO provider_events (provider, event_id, organization_id, payroll_run_id, event_type) " +
    "VALUES ('paymongo', 'SYNTHETIC-EVENT', 2, 702, 'transfer.updated')",
    [], "23505",
  );
  await assertExpectedFailure(
    "INSERT INTO provider_events (provider, event_id, organization_id, payroll_run_id, event_type) " +
    "VALUES ('paymongo', 'SYNTHETIC-INVALID-ORG', 9000, 701, 'transfer.updated')",
    [], "23503",
  );
  accepted.uniqueConstraintsVerified = true;

  await client.query(
    "INSERT INTO audit_events (organization_id, actor, action, resource, metadata) " +
    "VALUES (1, 'CI actor', 'post-migration', 'synthetic', '{}'::jsonb)",
  );
  const sealed = await client.query("SELECT seal_audit_events(100) AS sealed");
  assert.equal(Number(sealed.rows[0]?.sealed), 2,
    "REHEARSAL_PRIOR_AUDIT_EVENTS_NOT_SEALED");
  const chain = await client.query(
    "SELECT chain_seq, row_hash = audit_event_row_hash(prev_hash, chain_seq, " +
    "id, organization_id, actor, action, resource, metadata, created_at) AS intact " +
    "FROM audit_events WHERE organization_id = 1 ORDER BY chain_seq",
  );
  assert.deepEqual(chain.rows.map(row => [Number(row.chain_seq), row.intact]),
    [[1, true], [2, true]],
    "REHEARSAL_AUDIT_CHAIN_INTEGRITY_MISMATCH");
  await assertExpectedFailure(
    "UPDATE audit_events SET actor='unauthorized' WHERE organization_id=1",
    [], "42501",
  );
  accepted.auditProtectionVerified = true;

  const bank = await client.query("SELECT bank_account FROM employees WHERE id = 301");
  assert.equal(bank.rows[0]?.bank_account, syntheticBankMarker,
    "REHEARSAL_EXISTING_BANK_FIELD_CHANGED");
  accepted.syntheticBankFieldPreserved = true;
}

async function main() {
  // Fail before even creating a database client for a remote or non-CI target.
  const connectionString = assertIsolatedMigrationTarget(process.env);
  const source = migrations.map(path => ({
    path,
    content: readFileSync(path, "utf8"),
  }));
  for (const migration of source) {
    digest.update(migration.path + "\0", "utf8");
    digest.update(migration.content, "utf8");
    digest.update("\n", "utf8");
  }
  client = new Client({ connectionString, connectionTimeoutMillis: 5000, query_timeout: 10000 });

  try {
    await client.connect();
    connected = true;
    const identity = await client.query(
      "SELECT current_database() AS db, current_user AS role, " +
      "current_setting('server_version_num')::int AS version",
    );
    const db = identity.rows[0];
    assert.ok(db?.db === "app_db" && db?.role === "postgres" &&
      db?.version >= 160000 && db?.version < 170000,
    "REHEARSAL_POSTGRES16_DISPOSABLE_IDENTITY_FAILED");

    await client.query("BEGIN");
    transactionOpen = true;
    await client.query("SET LOCAL statement_timeout = '10000ms'");
    await client.query("SET LOCAL lock_timeout = '2000ms'");
    await client.query('CREATE SCHEMA "' + schema + '"');
    await client.query('SET LOCAL search_path TO "' + schema + '", pg_catalog');

    await seedSyntheticPredecessors();
    // This is an integrated test of SELECTED late migrations, not the
    // historical 124-file chain or an inferred production migration order.
    for (let pass = 0; pass < 2; pass += 1) {
      for (const migration of source) await client.query(migration.content);
      await inspectReleaseObjects();
    }
    accepted.migrationsReplayedTwice = true;
    accepted.releaseObjectsVerified = true;
    await exerciseConstraintsAndAudit();
  } finally {
    if (transactionOpen && connected) {
      try {
        await client.query("ROLLBACK");
        transactionOpen = false;
      } catch {
        failed = true;
        // Failed rollback means this connection must be terminated; no
        // success claim is possible and no outside-target cleanup is attempted.
      }
    }
    if (connected && !transactionOpen) {
      try {
        const result = await client.query(
          "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace " +
          "WHERE nspname = $1) AS remains",
          [schema],
        );
        accepted.rollbackVerified = result.rows[0]?.remains === false;
        if (!accepted.rollbackVerified) failed = true;
      } catch {
        failed = true;
      }
    }
    if (client) {
      try { await client.end(); } catch { failed = true; }
    }
  }
  if (failed || !Object.values(accepted).every(Boolean)) {
    throw new Error("REHEARSAL_INCOMPLETE");
  }
  mkdirSync("qa-artifacts", { recursive: true });
  writeFileSync("qa-artifacts/release-schema-rehearsal.json", JSON.stringify({
    schemaVersion: 1,
    kind: "synthetic-postgresql16-critical-migration-bundle-rehearsal",
    mode: "isolated-ci-only",
    sourceFiles: source.map(item => item.path),
    sourceDigest: digest.digest("hex"),
    ...accepted,
    syntheticDataOnly: true,
    realEmployerDataAccessed: false,
    productionCloneRehearsed: false,
    appliedMigrationReceiptsVerified: false,
    databaseChangesCommitted: false,
    productionReleaseApproved: false,
  }, null, 2) + "\n");
  console.log("Critical migrations passed the synthetic PostgreSQL 16 rollback-only rehearsal.");
}

try {
  await main();
} catch {
  // Do not echo raw PG SQL/errors, account values, connection strings or
  // untrusted rows to CI output.
  console.error("ISOLATED_RELEASE_SCHEMA_REHEARSAL_FAILED; no production target was accessed.");
  process.exitCode = 1;
}
