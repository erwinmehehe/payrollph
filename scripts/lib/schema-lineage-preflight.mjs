/**
 * PostgreSQL-catalog-only lineage fingerprint for reviewed forward migrations.
 * No SELECT is made against tenant, employee, payroll, identity or bank rows.
 *
 * An old client_id/UUID schema is a DIFFERENT database lineage from the
 * current organization_id/integer Drizzle model. Forward numbered SQL
 * migrations are not a safe conversion mechanism between these models.
 */
export const REQUIRED_MODERN_SCHEMA_COLUMNS = Object.freeze([
  ["organizations", "id"],
  ["employees", "id"],
  ["employees", "organization_id"],
  ["payroll_runs", "id"],
  ["payroll_runs", "organization_id"],
  ["payroll_entries", "id"],
  ["payroll_entries", "payroll_run_id"],
  ["payout_transfers", "id"],
  ["provider_events", "id"],
]);

/** Static query; interpolates no user data. Restricts metadata to public
 * tables and expected integer identifiers, not SELECT permissions or data. */
export const MODERN_SCHEMA_LINEAGE_SQL = [
  "WITH required(table_name, column_name) AS (",
  "  VALUES",
  "    ('organizations', 'id'),",
  "    ('employees', 'id'),",
  "    ('employees', 'organization_id'),",
  "    ('payroll_runs', 'id'),",
  "    ('payroll_runs', 'organization_id'),",
  "    ('payroll_entries', 'id'),",
  "    ('payroll_entries', 'payroll_run_id'),",
  "    ('payout_transfers', 'id'),",
  "    ('provider_events', 'id')",
  ")",
  'SELECT required.table_name AS "tableName",',
  '  required.column_name AS "columnName",',
  '  COALESCE(c.oid IS NOT NULL AND a.attnum > 0',
  "    AND a.atttypid = 'pg_catalog.int4'::pg_catalog.regtype, false)",
  '    AS "matchesExpectedType"',
  "FROM required",
  "LEFT JOIN pg_catalog.pg_class c",
  "  ON c.relnamespace = 'public'::pg_catalog.regnamespace",
  "  AND c.relname = required.table_name",
  "  AND c.relkind IN ('r', 'p')",
  "LEFT JOIN pg_catalog.pg_attribute a",
  "  ON a.attrelid = c.oid AND a.attname = required.column_name",
  "  AND a.attnum > 0 AND NOT a.attisdropped",
  "ORDER BY required.table_name, required.column_name",
].join("\n");

export function evaluateModernSchemaLineage(rows) {
  if (!Array.isArray(rows) || rows.length !== REQUIRED_MODERN_SCHEMA_COLUMNS.length) {
    throw new Error("REVIEWED_MIGRATION_LINEAGE_METADATA_UNVERIFIED");
  }
  const expected = new Set(
    REQUIRED_MODERN_SCHEMA_COLUMNS.map(([table, column]) => table + "." + column),
  );
  const present = new Set();
  let incompatible = 0;
  for (const row of rows) {
    const key = String(row?.tableName ?? "") + "." + String(row?.columnName ?? "");
    if (!expected.has(key) || present.has(key) ||
        typeof row.matchesExpectedType !== "boolean") {
      throw new Error("REVIEWED_MIGRATION_LINEAGE_METADATA_UNVERIFIED");
    }
    present.add(key);
    if (!row.matchesExpectedType) incompatible += 1;
  }
  return {
    compatible: incompatible === 0,
    expectedColumns: expected.size,
    incompatibleColumns: incompatible,
    inspectedTenantOrBankRows: false,
    permitsLegacyInPlaceConversion: false,
  };
}

export async function assertModernSchemaLineage(client) {
  if (!client || typeof client.query !== "function") {
    throw new Error("REVIEWED_MIGRATION_LINEAGE_METADATA_UNVERIFIED");
  }
  const response = await client.query(MODERN_SCHEMA_LINEAGE_SQL);
  const result = evaluateModernSchemaLineage(response?.rows);
  if (!result.compatible) {
    throw new Error("REVIEWED_MIGRATION_LEGACY_SCHEMA_INCOMPATIBLE");
  }
  return result;
}
