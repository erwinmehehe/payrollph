#!/usr/bin/env node
import { inventoryMigrationSources, reconcileMigrationReceipts } from './lib/migration-receipt-audit.mjs';

const inventory = inventoryMigrationSources();
const mode = process.argv[2];

if (mode === '--inventory' && process.argv.length === 3) {
  console.log(JSON.stringify({
    kind: 'sql-source-inventory-only',
    numberedSqlFiles: inventory.files.length,
    legacyDuplicatePrefixGroups: inventory.duplicatePrefixes,
    sourceManifestDigest: inventory.digest,
    historicalBaselinePresent: inventory.baselinePresent,
    databaseConnected: false,
    releaseApproved: false,
  }, null, 2));
} else if (mode === '--verify' && process.argv.length === 3) {
  await verify().catch(() => {
    // Never surface raw PostgreSQL errors, credentials or bank/payroll values.
    console.error('Read-only migration receipt audit FAILED; verify target, permissions and DBA journal privately.');
    process.exitCode = 1;
  });
} else {
  console.error('Use --inventory (no DB) or --verify (protected read-only GitHub workflow).');
  process.exitCode = 2;
}

async function verify() {
  const ref = process.env.GITHUB_REF;
  const reviewedSha = process.env.REVIEWED_SHA;
  const runningSha = process.env.GITHUB_SHA;
  const dbName = process.env.EXPECTED_PRODUCTION_DATABASE_NAME;
  const dbUrl = process.env.PRODUCTION_MIGRATION_AUDIT_DATABASE_URL;
  if (process.env.GITHUB_ACTIONS !== 'true' || ref !== 'refs/heads/main' ||
      !/^[0-9a-f]{40}$/.test(reviewedSha ?? '') || reviewedSha !== runningSha ||
      !/^[A-Za-z0-9_]{1,63}$/.test(dbName ?? '') || !dbUrl) {
    throw new Error('Missing reviewed target and protected read-only database authorization.');
  }

  const { Client } = await import('pg');
  const client = new Client({ connectionString: dbUrl, connectionTimeoutMillis: 8000, query_timeout: 8000 });
  let connected = false;
  let inTransaction = false;
  try {
    await client.connect();
    connected = true;
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    inTransaction = true;
    await client.query("SET LOCAL statement_timeout = '7000ms'");
    await client.query("SET LOCAL lock_timeout = '2000ms'");
    await client.query('SET LOCAL search_path = pg_catalog');

    const identity = await client.query(`
      SELECT current_database() = $1::text AS "databaseMatches",
        current_setting('transaction_read_only') = 'on' AS "readOnly",
        EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = current_user AND
          (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls)) AS "elevated",
        pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE') OR
        pg_catalog.has_database_privilege(current_user, current_database(), 'CREATE') OR
        EXISTS (
          SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
            AND pg_catalog.has_table_privilege(current_user, c.oid,
              'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        ) AS "hasWritePrivileges",
        EXISTS (
          SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = ANY(ARRAY[
            'employees', 'payroll_entries', 'payroll_runs', 'legal_entities',
            'employee_payout_change_requests'])
            AND pg_catalog.has_any_column_privilege(current_user, c.oid, 'SELECT')
        ) AS "canReadPayrollRows",
        pg_catalog.to_regclass('public.payrollph_release_migration_receipts') IS NOT NULL AS "journalPresent"
    `, [dbName]);
    const guard = identity.rows[0];
    if (!guard?.databaseMatches || !guard?.readOnly || guard?.elevated ||
        guard?.hasWritePrivileges || guard?.canReadPayrollRows || !guard?.journalPresent) {
      throw new Error('Database, catalog-only role or receipt journal is not approved.');
    }

    const receipts = await client.query(`
      SELECT migration_path AS "migrationPath", source_sha256 AS sha256,
        disposition, evidence_ref AS "evidenceRef", reviewed_by AS "reviewedBy",
        recorded_at AS "recordedAt"
      FROM public.payrollph_release_migration_receipts ORDER BY migration_path
    `);
    const outcome = reconcileMigrationReceipts(inventory, receipts.rows);
    await client.query('ROLLBACK');
    inTransaction = false;
    console.log(JSON.stringify({
      kind: 'read-only-migration-receipt-audit',
      reviewedSha,
      databaseNameMatches: true,
      dedicatedCatalogReaderVerified: true,
      sourceManifestDigest: inventory.digest,
      sourceFiles: outcome.checkedFiles,
      legacyDuplicatePrefixGroups: outcome.duplicatePrefixGroups,
      recordedReceipts: outcome.receivedRows,
      dispositionCounts: outcome.counts,
      issues: outcome.issues.slice(0, 40),
      additionalIssueCount: Math.max(0, outcome.issues.length - 40),
      receiptsReconciled: outcome.receiptsReconciled,
      productionReleaseApproved: false,
      changesApplied: false,
    }, null, 2));
    if (!outcome.receiptsReconciled) process.exitCode = 1;
  } finally {
    if (inTransaction) {
      try { await client.query('ROLLBACK'); } catch { /* connection loss */ }
    }
    if (connected) {
      try { await client.end(); } catch { /* connection loss */ }
    }
  }
}
