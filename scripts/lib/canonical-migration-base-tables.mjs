/**
 * Read-only, source-owned **table-name** prerequisite matrix for canonical
 * 0115-0119. A table's existence cannot certify columns, constraints,
 * historical migration receipts, application compatibility or release safety.
 */
export const CANONICAL_MIGRATION_BASE_TABLES = Object.freeze({
  "0115_inline_first_payroll_journey.sql": ["organizations", "users"],
  "0116_wfm_roster_scale_rules.sql": [
    "organizations", "users", "employee_schedule_assignments", "employee_worksite_assignments",
  ],
  "0117_xendit_payout_provider.sql": [
    "payout_batches", "payout_transfers", "payout_batch_transfers", "payout_profiles",
  ],
  "0118_wfm_punch_evidence.sql": [
    "organizations", "users", "employees", "worksites", "time_punches",
  ],
  "0119_multi_entity_v2_scope_transfer.sql": [
    "organizations", "users", "legal_entities", "employees", "payroll_runs",
    "payroll_entries", "payslips", "payroll_jobs", "payout_batches",
    "payout_transfers", "bank_file_validations", "historical_payroll_entries",
    "year_end_adjustments", "separation_records", "user_organizations",
    "org_units", "worker_employment_events",
  ],
});

const tableNames = [...new Set(Object.values(CANONICAL_MIGRATION_BASE_TABLES).flat())].sort();
/** All SQL identifiers are fixed source constants; no user input enters SQL. */
export const CANONICAL_MIGRATION_BASE_TABLES_SQL = [
  "SELECT requested.name AS table_name,",
  "  to_regclass(format('public.%I', requested.name)) IS NOT NULL AS present",
  "FROM (VALUES",
  tableNames.map(name => `  ('${name}')`).join(",\n"),
  ") AS requested(name)",
  "ORDER BY requested.name",
].join("\n");

export function assessCanonicalMigrationTables(rows) {
  if (!Array.isArray(rows)) {
    throw new Error("Canonical migration table inventory is unavailable.");
  }
  const found = new Map();
  for (const row of rows) {
    if (!row || typeof row.table_name !== "string" || typeof row.present !== "boolean"
      || !tableNames.includes(row.table_name) || found.has(row.table_name)) {
      throw new Error("Canonical migration table inventory is incomplete or inconsistent.");
    }
    found.set(row.table_name, row.present);
  }
  const migrations = Object.entries(CANONICAL_MIGRATION_BASE_TABLES).map(([file, dependencies]) => {
    const missingBaseTables = dependencies.filter(name => found.get(name) !== true);
    return {
      file,
      migration: file.slice(0, 4),
      missingBaseTables,
      structuralTargetsPresentOnly: missingBaseTables.length === 0,
      status: missingBaseTables.length === 0
        ? "TARGET_TABLES_PRESENT_NOT_DDL_OR_RELEASE_APPROVAL"
        : "BLOCKED_MISSING_BASE_TABLES",
    };
  });
  return {
    migrations,
    wholeTrainBaseTablesPresent: migrations.every(row => row.structuralTargetsPresentOnly),
    productionMigrationApproved: false,
  };
}
