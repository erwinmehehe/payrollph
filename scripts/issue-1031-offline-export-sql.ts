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

/**
 * Enrich only the offline export with index attributes that the existing
 * #1605 guard already understands. Keep #1075's shared catalog query intact.
 * A missing catalog match returns NULL details and fails offline validation.
 */
const offlineIndexAugmentationSql = `
SELECT c.table_name, c.kind, c.object_name,
 CASE WHEN c.kind = 'index' THEN c.details || meta.details ELSE c.details END AS details
FROM offline_catalog c
LEFT JOIN LATERAL (
 SELECT pg_catalog.jsonb_build_object(
   'key_desc', (SELECT COALESCE(
     pg_catalog.jsonb_agg((ind.indoption[pos.n - 1] & 1) <> 0 ORDER BY pos.n),
     '[]'::jsonb)
     FROM pg_catalog.generate_series(1, ind.indnkeyatts) AS pos(n)),
   'key_nulls_first', (SELECT COALESCE(
     pg_catalog.jsonb_agg((ind.indoption[pos.n - 1] & 2) <> 0 ORDER BY pos.n),
     '[]'::jsonb)
     FROM pg_catalog.generate_series(1, ind.indnkeyatts) AS pos(n)),
   'include', (SELECT COALESCE(
     pg_catalog.jsonb_agg(att.attname ORDER BY pos.n), '[]'::jsonb)
     FROM pg_catalog.generate_series(ind.indnkeyatts + 1, ind.indnatts) AS pos(n)
     JOIN pg_catalog.pg_attribute att
       ON att.attrelid = tbl.oid AND att.attnum = ind.indkey[pos.n - 1]),
   'options', COALESCE(pg_catalog.to_jsonb(idx.reloptions), '[]'::jsonb),
   'tablespace', CASE WHEN idx.reltablespace = 0 THEN NULL ELSE tsp.spcname END,
   'nulls_not_distinct', ind.indnullsnotdistinct
 ) AS details
 FROM pg_catalog.pg_namespace ns
 JOIN pg_catalog.pg_class tbl ON tbl.relnamespace = ns.oid
 JOIN pg_catalog.pg_index ind ON ind.indrelid = tbl.oid
 JOIN pg_catalog.pg_class idx ON idx.oid = ind.indexrelid
 LEFT JOIN pg_catalog.pg_tablespace tsp ON tsp.oid = idx.reltablespace
 WHERE c.kind = 'index' AND ns.nspname = 'public'
   AND tbl.relkind IN ('r', 'p') AND tbl.relname = c.table_name
   AND idx.relname = c.object_name
) meta ON TRUE
`;

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
    "), enriched_catalog AS (",
    offlineIndexAugmentationSql.trim(),
    "), payload AS (",
    " SELECT",
    " (SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(",
    "   'table_name', c.table_name, 'kind', c.kind, 'object_name', c.object_name,",
    "   'details', c.details) ORDER BY c.table_name, c.kind, c.object_name),",
    "   '[]'::jsonb) FROM enriched_catalog c) AS catalog_rows,",
    " (SELECT pg_catalog.count(*) FROM enriched_catalog) AS catalog_count,",
    " (SELECT pg_catalog.count(*) FROM enriched_catalog WHERE kind = 'table') AS table_count,",
    " " + historical + " AS historical_rows,",
    " " + applied + " AS applied_rows",
    ")",
    "SELECT pg_catalog.jsonb_build_object(",
    " 'formatVersion', 2,",
    " 'exportKind', '" + kind + "',",
    " 'postgresMajor', current_setting('server_version_num')::integer / 10000,",
    " 'catalogRows', catalog_rows,",
    " 'catalogRowCount', catalog_count,",
    " 'tableCount', table_count,",
    " 'historicalReceipts', historical_rows,",
    " 'appliedMigrations', applied_rows,",
    " 'journalRowCount', pg_catalog.jsonb_array_length(historical_rows) + pg_catalog.jsonb_array_length(applied_rows),",
    " 'completed', 'ISSUE_1031_CATALOG_EXPORT_COMPLETE_V2'",
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
