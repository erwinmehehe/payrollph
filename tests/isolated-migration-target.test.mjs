import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertIsolatedMigrationTarget } from "../scripts/lib/isolated-migration-target.mjs";

const allowed = {
  CI: "true",
  GITHUB_ACTIONS: "true",
  MIGRATION_REHEARSAL_MODE: "isolated-ci-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
};

test("isolated migration rehearsal accepts only the known disposable CI database", () => {
  assert.equal(assertIsolatedMigrationTarget(allowed), allowed.DATABASE_URL);
  assert.ok(assertIsolatedMigrationTarget({
    ...allowed, DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/app_db",
  }).includes("localhost"));
});

test("CI or explicit isolation flag missing rejects before any DB client exists", () => {
  for (const bad of [
    { CI: undefined }, { CI: "false" }, { GITHUB_ACTIONS: "false" },
    { GITHUB_ACTIONS: undefined }, { MIGRATION_REHEARSAL_MODE: undefined },
    { MIGRATION_REHEARSAL_MODE: "production-restore" },
  ]) {
    assert.throws(() => assertIsolatedMigrationTarget({ ...allowed, ...bad }),
      /MIGRATION_REHEARSAL_CI_ONLY/);
  }
});

test("remote, renamed, nonstandard or query-mutated database URLs are rejected", () => {
  for (const db of [
    "postgresql://postgres:postgres@db.example.com:5432/app_db",
    "postgresql://postgres:postgres@10.0.0.10:5432/app_db",
    "postgresql://postgres:postgres@127.0.0.1:5432/payroll_prod",
    "postgresql://postgres:postgres@127.0.0.1:5433/app_db",
    "postgresql://payroll_owner:postgres@127.0.0.1:5432/app_db",
    "postgresql://postgres:postgres@127.0.0.1:5432/app_db?sslmode=require",
    "postgresql://postgres:postgres@127.0.0.1:5432/app_db#fragment",
    "https://postgres:postgres@127.0.0.1:5432/app_db",
    "not a connection url",
    "",
  ]) {
    assert.throws(() => assertIsolatedMigrationTarget({ ...allowed, DATABASE_URL: db }),
      /MIGRATION_REHEARSAL_DISPOSABLE_DB_ONLY/, db);
  }
});

test("rehearsal runs selected late migrations together, tests rejection paths, and never commits", () => {
  const script = readFileSync("scripts/rehearse-critical-release-migrations.mjs", "utf8");
  for (const marker of [
    "0100_compensation_automation_intents.sql",
    "0106_saas_selfserve_recurring_billing.sql",
    "0109_tamper_evident_audit_chain.sql",
    "0110_provider_events_inbox.sql",
    "assertIsolatedMigrationTarget(process.env)",
    "CREATE SCHEMA",
    "SET LOCAL search_path",
    "pg_catalog.pg_attribute",
    "releaseIndexCatalogSql",
    "validatedReleaseIndexes",
    "evaluateReleaseSchemaInventory",
    "assertExpectedFailure(",
    "seal_audit_events(100)",
    "REHEARSAL_AUDIT_CHAIN_INTEGRITY_MISMATCH",
    "syntheticBankFieldPreserved",
    "REHEARSAL_DISPOSABLE_DATABASE_NOT_EMPTY",
    "expectedFailureObserved",
    "--inject-failure",
    "ROLLBACK",
    "WHERE nspname = $1",
    "productionCloneRehearsed: false",
    "databaseChangesCommitted: false",
    "productionReleaseApproved: false",
  ]) assert.ok(script.includes(marker), "Missing rehearsal boundary: " + marker);

  assert.ok(script.indexOf("assertIsolatedMigrationTarget(process.env)") <
    script.indexOf("new Client("), "A remote URL must fail before creating a DB client");
  assert.ok(script.indexOf('await client.query("ROLLBACK")') >
    script.indexOf("await exerciseConstraintsAndAudit()"));
  assert.doesNotMatch(script, /process\.env\.(?:PRODUCTION_DATABASE_URL|PRODUCTION_BANK_DATA_ENCRYPTION_KEY)/);
  assert.doesNotMatch(script, /await client\.query\("COMMIT"\)/);
});

test("isolated migration workflow has local Postgres16 only and zero production secrets", () => {
  const workflow = readFileSync(".github/workflows/isolated-release-schema-rehearsal.yml", "utf8");
  assert.match(workflow, /postgres:16/);
  assert.match(workflow, /MIGRATION_REHEARSAL_MODE: isolated-ci-only/);
  assert.match(workflow, /postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/app_db/);
  assert.match(workflow, /node --test tests\/isolated-migration-target\.test\.mjs/);
  assert.match(workflow, /npx tsx scripts\/rehearse-critical-release-migrations\.mjs/);
  assert.match(workflow, /npx tsx scripts\/rehearse-critical-release-migrations\.mjs --inject-failure/);
  assert.match(workflow, /cat qa-artifacts\/release-schema-failure-rehearsal\.json/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /secrets\.|environment: production|DATABASE_URL_UNPOOLED|--prod|db:push|db:migrate/);
});
