import { assertCatalogAuditorPrivilegeBoundary, catalogAuditorConnectionOptions } from "./lib/production-catalog-auditor-gate.mjs";
import { Client } from "pg";
import {
  evaluateReleaseSchemaInventory,
  requiredReleaseColumns,
  requiredReleaseIndexes,
  requiredReleaseTables,
  validatedReleaseIndexes,
  releaseIndexCatalogSql,
  type ReleaseIndexMetadata,
} from "../src/lib/production-schema-inventory";

/**
 * Protected-operator production preflight. Uses PostgreSQL catalog metadata
 * only. BEGIN READ ONLY prohibits writes; the role/privilege guard also
 * requires a separate catalog-only account with no payroll-row access.
 */
async function main() {
  const connectionString = process.env.PRODUCTION_DATABASE_URL;
  const expectedDatabase = process.env.EXPECTED_PRODUCTION_DATABASE_NAME;
  if (!connectionString || !expectedDatabase) {
    console.error("Missing protected database connection or reviewed database identity. The preflight did not connect.");
    process.exitCode = 2;
    return;
  }

  let options;
  try { options = catalogAuditorConnectionOptions(connectionString, expectedDatabase); }
  catch { console.error("Catalog connection must use the pinned protected TLS endpoint; no database queried."); process.exitCode = 2; return; }
  const client = new Client(options);
  let connected = false;
  let transactionOpen = false;
  try {
    await client.connect();
    connected = true;
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    transactionOpen = true;
    await client.query("SET LOCAL statement_timeout = '7000ms'");
    await client.query("SET LOCAL lock_timeout = '2000ms'");
    await client.query("SET LOCAL search_path = pg_catalog");
    await assertCatalogAuditorPrivilegeBoundary(client, { expectedDatabase });

    // Verify the named database and a genuinely least-privileged catalog role.
    // A read-only transaction alone is insufficient if someone accidentally
    // provisions the production writer credential into GitHub Actions.
    const identity = await client.query<{
      databaseMatches: boolean;
      readOnly: boolean;
      elevated: boolean;
      canWrite: boolean;
      canReadPayrollRows: boolean;
    }>(`
      SELECT
        current_database() = $1::text AS "databaseMatches",
        current_setting('transaction_read_only') = 'on' AS "readOnly",
        EXISTS (
          SELECT 1 FROM pg_catalog.pg_roles r
          WHERE r.rolname = current_user AND
            (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls)
        ) AS elevated,
        EXISTS (
          SELECT 1 FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relname = ANY($2::text[])
            AND pg_catalog.has_table_privilege(current_user, c.oid,
              'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        ) AS "canWrite",
        EXISTS (
          SELECT 1 FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relname = ANY(ARRAY['employees', 'payroll_entries', 'payroll_runs', 'separation_records'])
            AND pg_catalog.has_any_column_privilege(current_user, c.oid, 'SELECT')
        ) AS "canReadPayrollRows"
    `, [expectedDatabase, [...requiredReleaseTables]]);
    if (!identity.rows[0]?.databaseMatches || !identity.rows[0]?.readOnly
      || identity.rows[0].elevated || identity.rows[0].canWrite
      || identity.rows[0].canReadPayrollRows) {
      throw new Error("Production database identity or catalog-only access guard failed.");
    }

    // Names are fixed in reviewed source; these queries do not read app rows,
    // tenant identifiers, salaries, financial credentials or bank accounts.
    const tables = await client.query<{ name: string }>(
      "SELECT c.relname AS name FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND c.relname = ANY($1::text[])",
      [[...requiredReleaseTables]],
    );
    // information_schema.columns hides columns from catalog-only roles
    // without SELECT on application data. pg_attribute is metadata-only.
    const columns = await client.query<{ name: string }>(
      "SELECT c.relname || '.' || a.attname AS name FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND a.attnum > 0 AND NOT a.attisdropped AND (c.relname || '.' || a.attname) = ANY($1::text[])",
      [[...requiredReleaseColumns]],
    );
    const indexes = await client.query<ReleaseIndexMetadata>(
      releaseIndexCatalogSql, [[...requiredReleaseIndexes], "public"],
    );
    const functions = await client.query<{ present: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.oid = to_regprocedure('public.seal_audit_events(integer)')) AS present",
    );
    const triggers = await client.query<{ name: string }>(
      "SELECT c.relname || '.' || t.tgname AS name FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'audit_events' AND NOT t.tgisinternal AND t.tgenabled IN ('O','A') AND (t.tgtype & 27) = 27 AND t.tgfoid IN (to_regprocedure('public.audit_events_protect()'), to_regprocedure('public.audit_events_protect_v2()')) AND t.tgname = 'audit_events_protect_mutation'",
    );
    const evaluation = evaluateReleaseSchemaInventory({
      tables: tables.rows.map((row) => row.name),
      columns: columns.rows.map((row) => row.name),
      indexes: validatedReleaseIndexes(indexes.rows),
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
      targetDatabaseIdentityConfirmed: true,
      leastPrivilegeCatalogRoleConfirmed: true,
      checkCommitSha: process.env.GITHUB_SHA ?? null,
    }, null, 2));
    process.exitCode = evaluation.schemaCompatible ? 0 : 1;
  } catch {
    if (transactionOpen) {
      try { await client.query("ROLLBACK"); } catch { /* connection may have failed */ }
    }
    // Never log PostgreSQL error text (it could expose sensitive details).
    console.error("Read-only schema preflight failed: confirm expected DB identity, dedicated catalog-only role, and catalog structure. No raw DB error details are logged.");
    process.exitCode = 2;
  } finally {
    if (connected) {
      try { await client.end(); } catch { /* socket may already be closed */ }
    }
  }
}

void main();
