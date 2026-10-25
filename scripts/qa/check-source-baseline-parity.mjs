#!/usr/bin/env node
/**
 * READ-ONLY, disposable PG18 source-to-catalog comparison.
 * Run after guarded first Drizzle push and source baseline supplement.
 * Never connects to Neon and never reads business rows.
 */
import assert from "node:assert/strict";
import pg from "pg";
import { generateSchemaManifest } from "../lib/issue-1031-schema-manifest.ts";
import { assertSourceBaselineParity } from "../lib/source-baseline-parity.mjs";
import { assertDisposablePG18Environment } from "./fresh-pg18-development-schema.mjs";

const URL = "postgresql://postgres:postgres@127.0.0.1:5432/app_db";

async function main() {
  assertDisposablePG18Environment(process.env);
  assert.equal(process.env.DATABASE_URL, URL, "DISPOSABLE_LOOPBACK_ONLY");
  assert.equal(process.env.PRODUCTION_DATABASE_URL, undefined, "NO_PRODUCTION_CREDENTIALS");
  const client = new pg.Client({
    connectionString: URL,
    connectionTimeoutMillis: 5000,
    query_timeout: 15000,
    statement_timeout: 15000,
  });
  await client.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try {
      const result = await client.query(
        "SELECT current_database() AS database, current_user AS login, " +
        "current_setting('server_version_num')::integer AS server"
      );
      const identity = result.rows[0];
      assert.equal(identity.database, "app_db");
      assert.equal(identity.login, "postgres");
      assert.ok(identity.server >= 180000 && identity.server < 190000, "PG18_REQUIRED");
      const columns = await client.query(
        "SELECT c.relname AS table_name, a.attname AS column_name " +
        "FROM pg_catalog.pg_class c " +
        "JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace " +
        "JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid " +
        "WHERE n.nspname='public' AND c.relkind IN ('r','p') " +
        "AND a.attnum>0 AND NOT a.attisdropped " +
        "ORDER BY c.relname,a.attnum"
      );
      const manifest = generateSchemaManifest();
      const resultSummary = assertSourceBaselineParity(manifest.tables, columns.rows);
      assert.ok(resultSummary.sourceTables >= 270, "SOURCE_MANIFEST_INCOMPLETE");
      await client.query("ROLLBACK");
      process.stdout.write("SOURCE_BASELINE_PARITY_PASS " + JSON.stringify({
        sourceTables: resultSummary.sourceTables,
        sourceColumns: resultSummary.sourceColumns,
        baselineOnlyTables: resultSummary.migrationOrBaselineOnlyTables.length,
        additionalMigrationColumns: resultSummary.unmodeledColumns.length,
        scope: "source table/column presence only; no live migration approval",
        productionCertified: false,
      }) + "\n");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((error) => {
  // Table/column names in failures are static schema identifiers, never data.
  process.stderr.write("SOURCE_BASELINE_PARITY_FAILED " +
    (error instanceof Error ? error.message : "unknown") + "\n");
  process.exitCode = 1;
});
