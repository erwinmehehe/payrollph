import {
  evaluateReleaseSchemaInventory,
  releaseIndexCatalogSql,
  requiredReleaseColumns,
  requiredReleaseIndexes,
  requiredReleaseTables,
  validatedReleaseIndexes,
  type ReleaseIndexMetadata,
} from "@/lib/production-schema-inventory";

type CatalogRow = Record<string, unknown>;
export type CatalogQuery = (
  sql: string, parameters?: unknown[],
) => Promise<{ rows: CatalogRow[] }>;

/**
 * Deliberately does not flip the production default until DBA/release approval.
 * An explicit, invalid mode is an error rather than an accidental legacy write.
 */
export function coreSchemaCompatibilityMode(value: string | undefined): "legacy" | "read-only" {
  if (value === undefined || value === "legacy") return "legacy";
  if (value === "read-only") return "read-only";
  throw new Error("Invalid CORE_SCHEMA_COMPATIBILITY_MODE; refusing runtime schema writes.");
}

/**
 * The live request-path alternative to 2,600 lines of automatic DDL.
 * Uses only pg_catalog metadata in a transaction that cannot persist writes.
 * Passing is a structural *subset* check, not a signed migration receipt,
 * full schema proof, bank backfill, or permission to release payroll.
 */
export async function verifyCoreSchemaReadOnly(query: CatalogQuery): Promise<void> {
  let begun = false;
  try {
    await query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    begun = true;
    await query("SET LOCAL statement_timeout = '7000ms'");
    await query("SET LOCAL lock_timeout = '2000ms'");
    await query("SET LOCAL search_path = pg_catalog");

    const transaction = await query(
      "SELECT current_setting('transaction_read_only') = 'on' AS ready",
    );
    if (transaction.rows[0]?.ready !== true) {
      throw new Error("CORE_SCHEMA_READONLY_TRANSACTION_REQUIRED");
    }
    const tables = await query(
      "SELECT c.relname AS name FROM pg_catalog.pg_class c " +
      "JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace " +
      "WHERE n.nspname = 'public' AND c.relkind IN ('r','p') " +
      "AND c.relname = ANY($1::text[])",
      [[...requiredReleaseTables]],
    );
    const columns = await query(
      "SELECT c.relname || '.' || a.attname AS name FROM pg_catalog.pg_attribute a " +
      "JOIN pg_catalog.pg_class c ON c.oid = a.attrelid " +
      "JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace " +
      "WHERE n.nspname = 'public' AND c.relkind IN ('r','p') " +
      "AND a.attnum > 0 AND NOT a.attisdropped " +
      "AND (c.relname || '.' || a.attname) = ANY($1::text[])",
      [[...requiredReleaseColumns]],
    );
    const indexes = await query(releaseIndexCatalogSql, [[...requiredReleaseIndexes], "public"]);
    const functions = await query(
      "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p " +
      "JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace " +
      "WHERE n.nspname = 'public' AND p.prokind = 'f' " +
      "AND p.oid = to_regprocedure('public.seal_audit_events(integer)')) AS present",
    );
    const triggers = await query(
      "SELECT c.relname || '.' || t.tgname AS name FROM pg_catalog.pg_trigger t " +
      "JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid " +
      "JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace " +
      "WHERE n.nspname = 'public' AND c.relname = 'audit_events' " +
      "AND NOT t.tgisinternal AND t.tgenabled IN ('O','A') " +
      "AND (t.tgtype & 27) = 27 " +
      "AND t.tgfoid = to_regprocedure('public.audit_events_protect()') " +
      "AND t.tgname = 'audit_events_protect_mutation'",
    );
    const result = evaluateReleaseSchemaInventory({
      tables: tables.rows.map(row => String(row.name ?? "")),
      columns: columns.rows.map(row => String(row.name ?? "")),
      indexes: validatedReleaseIndexes(
        indexes.rows as unknown as ReleaseIndexMetadata[],
      ),
      functions: functions.rows[0]?.present === true ? ["seal_audit_events(integer)"] : [],
      triggers: triggers.rows.map(row => String(row.name ?? "")),
    });
    if (!result.schemaCompatible) {
      throw new Error("CORE_SCHEMA_READONLY_PRECONDITION_FAILED: reviewed migration required.");
    }
  } finally {
    if (begun) {
      // A failed rollback makes the pooled connection unsafe to reuse.
      // Propagate the error so callers discard the connection instead.
      await query("ROLLBACK");
    }
  }
}
