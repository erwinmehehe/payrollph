/**
 * P0-4: validate the structure and privilege boundary of the three
 * independently DBA-adopted migration-control tables, using pg_catalog only.
 * This is NOT a migration, a history receipt, or a production release approval.
 */
export const MIGRATION_CONTROL_COLUMNS = Object.freeze([
  ["payrollph_release_migration_receipts", "migration_path", "pg_catalog.text", -1],
  ["payrollph_release_migration_receipts", "source_sha256", "pg_catalog.bpchar", 68],
  ["payrollph_release_migration_receipts", "disposition", "pg_catalog.text", -1],
  ["payrollph_release_migration_receipts", "evidence_ref", "pg_catalog.text", -1],
  ["payrollph_release_migration_receipts", "reviewed_by", "pg_catalog.text", -1],
  ["payrollph_release_migration_receipts", "recorded_at", "pg_catalog.timestamptz", -1],
  ["payrollph_migration_cutover", "id", "pg_catalog.int2", -1],
  ["payrollph_migration_cutover", "historical_prefix", "pg_catalog.int4", -1],
  ["payrollph_migration_cutover", "historical_manifest_sha256", "pg_catalog.bpchar", 68],
  ["payrollph_migration_cutover", "evidence_ref", "pg_catalog.text", -1],
  ["payrollph_migration_cutover", "reviewed_by", "pg_catalog.text", -1],
  ["payrollph_migration_cutover", "reviewed_at", "pg_catalog.timestamptz", -1],
  ["payrollph_schema_migrations", "migration_path", "pg_catalog.text", -1],
  ["payrollph_schema_migrations", "migration_number", "pg_catalog.int4", -1],
  ["payrollph_schema_migrations", "source_sha256", "pg_catalog.bpchar", 68],
  ["payrollph_schema_migrations", "applied_by", "pg_catalog.text", -1],
  ["payrollph_schema_migrations", "change_ref", "pg_catalog.text", -1],
  ["payrollph_schema_migrations", "applied_at", "pg_catalog.timestamptz", -1],
]);

const CONTROL_CHECK_COUNTS = Object.freeze([
  ["payrollph_release_migration_receipts", 5],
  ["payrollph_migration_cutover", 5],
  ["payrollph_schema_migrations", 6],
]);

const literal = name => {
  if (typeof name !== "string" || !/^[a-z0-9_.]+$/.test(name)) {
    throw new Error("REVIEWED_MIGRATION_CONTROL_LEDGER_SOURCE_INVALID");
  }
  return "'" + name + "'";
};

/** Every catalog condition must return EXACTLY true, never NULL or a string. */
export const MIGRATION_CONTROL_LEDGER_CATALOG_SQL = [
  "WITH expected_columns(relation_name,column_name,type_name,expected_typmod) AS (",
  " VALUES",
  MIGRATION_CONTROL_COLUMNS.map(([relation,col,type,mod]) =>
    " (" + [relation,col,type].map(literal).join(",") + "," + Number(mod) + ")"
  ).join(",\n"),
  "), expected_checks(relation_name,expected_count) AS (",
  " VALUES",
  CONTROL_CHECK_COUNTS.map(([relation,count]) =>
    " (" + literal(relation) + "," + Number(count) + ")"
  ).join(",\n"),
  "), matched_columns AS (",
  " SELECT COALESCE(c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped",
  "   AND a.atttypid = e.type_name::pg_catalog.regtype",
  "   AND a.atttypmod = e.expected_typmod AND a.attnotnull, false) AS matches",
  " FROM expected_columns e",
  " LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = 'public'",
  " LEFT JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid",
  "   AND c.relname = e.relation_name",
  " LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid",
  "   AND a.attname = e.column_name",
  ")",
  'SELECT (SELECT count(*) = 18 AND COALESCE(bool_and(matches),false)',
  '  FROM matched_columns) AS "controlColumnsValid",',
  ' (SELECT COALESCE(bool_and((',
  '   SELECT count(*) = 6 FROM pg_catalog.pg_attribute a',
  "   WHERE a.attrelid = pg_catalog.to_regclass('public.' || e.relation_name)",
  '     AND a.attnum > 0 AND NOT a.attisdropped',
  '  )),false) FROM expected_checks e) AS "controlColumnCountsValid",',
  ' (SELECT COALESCE(bool_and((',
  '   SELECT count(*) = e.expected_count FROM pg_catalog.pg_constraint k',
  "   WHERE k.conrelid = pg_catalog.to_regclass('public.' || e.relation_name)",
  "     AND k.contype = 'c' AND k.convalidated",
  '  ) AND NOT EXISTS (',
  '   SELECT 1 FROM pg_catalog.pg_constraint k',
  "   WHERE k.conrelid = pg_catalog.to_regclass('public.' || e.relation_name)",
  "     AND k.contype = 'c' AND NOT k.convalidated",
  '  )),false) FROM expected_checks e) AS "controlChecksValid",',
  ' EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k',
  "   WHERE k.conrelid = pg_catalog.to_regclass('public.payrollph_schema_migrations')",
  "     AND k.contype = 'c' AND k.convalidated",
  "     AND k.conname = 'migration_number_matches_path'",
  ' ) AS "controlNumberMatchesPath",',
  ' NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c',
  '   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace',
  "   WHERE n.nspname = 'public'",
  "     AND c.relname IN ('payrollph_release_migration_receipts',",
  "       'payrollph_migration_cutover','payrollph_schema_migrations')",
  '     AND (',
  "       pg_catalog.pg_has_role(current_user,c.relowner,'MEMBER')",
  '       OR pg_catalog.has_table_privilege(current_user,c.oid,',
  "         CASE WHEN c.relname = 'payrollph_schema_migrations'",
  "           THEN 'UPDATE,DELETE,TRUNCATE'",
  "           ELSE 'INSERT,UPDATE,DELETE,TRUNCATE' END)",
  "       OR pg_catalog.has_any_column_privilege(current_user,c.oid,'UPDATE')",
  '     )',
  ' ) AS "controlWritesDenied"',
].join("\n");

export const MIGRATION_CONTROL_LEDGER_REQUIRED_FLAGS = Object.freeze([
  "controlColumnsValid", "controlColumnCountsValid", "controlChecksValid",
  "controlNumberMatchesPath", "controlWritesDenied",
]);

export function verifyMigrationControlLedgerCatalog(rows) {
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] ||
      MIGRATION_CONTROL_LEDGER_REQUIRED_FLAGS.some(k => rows[0][k] !== true)) {
    throw new Error("REVIEWED_MIGRATION_CONTROL_LEDGER_INVALID");
  }
  return Object.freeze({
    controlStructureVerified: true,
    historicalReceiptsProven: false,
    productionReleaseApproved: false,
  });
}

export async function assertMigrationControlLedgerCatalog(client) {
  if (!client || typeof client.query !== "function") {
    throw new Error("REVIEWED_MIGRATION_CONTROL_LEDGER_INVALID");
  }
  const result = await client.query(MIGRATION_CONTROL_LEDGER_CATALOG_SQL);
  return verifyMigrationControlLedgerCatalog(result?.rows);
}
