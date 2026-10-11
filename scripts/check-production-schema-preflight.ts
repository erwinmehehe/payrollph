import { Client } from "pg";
import {
  evaluateReleaseSchemaInventory,
  requiredReleaseColumns,
  requiredReleaseIndexes,
  requiredReleaseTables,
} from "../src/lib/production-schema-inventory";

/**
 * Protected-operator production preflight. Uses pg_catalog/INFORMATION_SCHEMA
 * only. BEGIN READ ONLY prohibits writes even if the supplied DB role has
 * broader permissions. Prefer a dedicated least-privilege catalog reader.
 */
async function main() {
  const connectionString = process.env.PRODUCTION_DATABASE_URL;
  if (!connectionString) {
    console.error("Missing protected PRODUCTION_DATABASE_URL. The preflight did not connect.");
    process.exitCode = 2;
    return;
  }

  const client = new Client({ connectionString, connectionTimeoutMillis: 8000 });
  let connected = false;
  let transactionOpen = false;
  try {
    await client.connect();
    connected = true;
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    transactionOpen = true;
    await client.query("SET LOCAL statement_timeout = '7000ms'");

    // Names are fixed in reviewed source; these queries do not read app rows,
    // tenant identifiers, salaries, financial credentials or bank accounts.
    const tables = await client.query<{ name: string }>(
      "SELECT c.relname AS name FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND c.relname = ANY($1::text[])",
      [[...requiredReleaseTables]],
    );
    const columns = await client.query<{ name: string }>(
      "SELECT table_name || '.' || column_name AS name FROM information_schema.columns WHERE table_schema = 'public' AND (table_name || '.' || column_name) = ANY($1::text[])",
      [[...requiredReleaseColumns]],
    );
    const indexes = await client.query<{ name: string }>(
      "SELECT indexname AS name FROM pg_catalog.pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1::text[])",
      [[...requiredReleaseIndexes]],
    );
    const functions = await client.query<{ present: boolean }>(
      "SELECT to_regprocedure('public.seal_audit_events(integer)') IS NOT NULL AS present",
    );
    const triggers = await client.query<{ name: string }>(
      "SELECT c.relname || '.' || t.tgname AS name FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND NOT t.tgisinternal AND t.tgenabled IN ('O','A') AND t.tgname = 'audit_events_protect_mutation'",
    );
    const evaluation = evaluateReleaseSchemaInventory({
      tables: tables.rows.map((row) => row.name),
      columns: columns.rows.map((row) => row.name),
      indexes: indexes.rows.map((row) => row.name),
      functions: functions.rows[0]?.present ? ["seal_audit_events(integer)"] : [],
      triggers: triggers.rows.map((row) => row.name),
    });
    await client.query("ROLLBACK");
    transactionOpen = false;

    console.log(JSON.stringify({
      ...evaluation,
      structuralEvidenceOnly: true,
      productionPayrollDataQueried: false,
      productionSchemaModified: false,
      approvedForDeployment: false,
      checkCommitSha: process.env.GITHUB_SHA ?? null,
    }, null, 2));
    process.exitCode = evaluation.schemaCompatible ? 0 : 1;
  } catch {
    if (transactionOpen) {
      try { await client.query("ROLLBACK"); } catch { /* connection may have failed */ }
    }
    // Never log PostgreSQL error text (it could expose sensitive details).
    console.error("Read-only schema preflight could not complete. Check protected DB access and catalog permissions.");
    process.exitCode = 2;
  } finally {
    if (connected) {
      try { await client.end(); } catch { /* socket may already be closed */ }
    }
  }
}

void main();
