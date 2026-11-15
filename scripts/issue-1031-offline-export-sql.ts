/**
 * Prints owner-executed SQL ONLY. This program never opens a database.
 * Reuses #1075's fullSchemaCatalogSql rather than recreating its metadata query.
 * Export files stay private and outside Git, logs and CI artifacts.
 */
import { fullSchemaCatalogSql } from "./check-issue-1031-full-schema-diff";

function journalSql(kind: "production" | "disposable-pg18", table: "historic" | "forward"): string {
  if (kind === "disposable-pg18") return "'[]'::jsonb";
  if (table === "historic") {
    return "(SELECT COALESCE(pg_catalog.jsonb_agg(" +
      "pg_catalog.jsonb_build_object('migrationPath', migration_path, " +
      "'sha256', pg_catalog.btrim(source_sha256), 'disposition', disposition) " +
      "ORDER BY migration_path), '[]'::jsonb) " +
      "FROM public.payrollph_release_migration_receipts)";
  }
  return "(SELECT COALESCE(pg_catalog.jsonb_agg(" +
    "pg_catalog.jsonb_build_object('migrationPath', migration_path, " +
    "'sha256', pg_catalog.btrim(source_sha256)) " +
    "ORDER BY migration_path), '[]'::jsonb) " +
    "FROM public.payrollph_schema_migrations)";
}
export function buildIssue1031OfflineExportSql(kind: "production" | "disposable-pg18"): string {
  if (!["production", "disposable-pg18"].includes(kind)) throw Error("INVALID_EXPORT_KIND");
  const historical = journalSql(kind, "historic");
  const applied = journalSql(kind, "forward");
  // Existing source catalog query is the only source of shape metadata.
  // Journal SELECTs are the sole exception to catalog-only reading: two
  // approved migration-control ledgers, limited to paths/hashes/dispositions.
  return [
    "-- #1031. Owner-run READ ONLY metadata and approved migration journal export.",
    "-- Never run using an application writer or commit resulting JSON.",
    "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;",
    "SET LOCAL statement_timeout = '15000ms';",
    "SET LOCAL lock_timeout = '2000ms';",
    "SET LOCAL search_path = pg_catalog;",
    "WITH offline_catalog AS (",
    fullSchemaCatalogSql.trim(),
    "), payload AS (",
    " SELECT",
    " (SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(",
    "   'table_name', c.table_name, 'kind', c.kind, 'object_name', c.object_name,",
    "   'details', c.details) ORDER BY c.table_name, c.kind, c.object_name),",
    "   '[]'::jsonb) FROM offline_catalog c) AS catalog_rows,",
    " (SELECT pg_catalog.count(*) FROM offline_catalog) AS catalog_count,",
    " (SELECT pg_catalog.count(*) FROM offline_catalog WHERE kind = 'table') AS table_count,",
    " " + historical + " AS historical_rows,",
    " " + applied + " AS applied_rows",
    ")",
    "SELECT pg_catalog.jsonb_build_object(",
    " 'formatVersion', 1,",
    " 'exportKind', '" + kind + "',",
    " 'postgresMajor', current_setting('server_version_num')::integer / 10000,",
    " 'catalogRows', catalog_rows,",
    " 'catalogRowCount', catalog_count,",
    " 'tableCount', table_count,",
    " 'historicalReceipts', historical_rows,",
    " 'appliedMigrations', applied_rows,",
    " 'journalRowCount', pg_catalog.jsonb_array_length(historical_rows) + pg_catalog.jsonb_array_length(applied_rows),",
    " 'completed', 'ISSUE_1031_CATALOG_EXPORT_COMPLETE_V1'",
    ") FROM payload;",
    "ROLLBACK;",
    "",
  ].join("\n");
}
if (process.argv[1]?.endsWith("issue-1031-offline-export-sql.ts")) {
  const arg = process.argv[2];
  if (arg !== "--production" && arg !== "--disposable-pg18") {
    process.stderr.write("USAGE: tsx scripts/issue-1031-offline-export-sql.ts --production|--disposable-pg18\n");
    process.exitCode = 2;
  } else {
    process.stdout.write(buildIssue1031OfflineExportSql(
      arg === "--production" ? "production" : "disposable-pg18"));
  }
}
