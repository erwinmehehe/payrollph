/**
 * Read-only source-owned prerequisite inventory for the seven DRAFT SQL
 * files in #865 (0115-0121). Distinguish source-created earlier tables
 * from external prerequisites. Neither existence nor draft plans are
 * migration receipts, DBA approval, or permission to modify Neon.
 */
export const CANONICAL_MIGRATION_BASE_TABLES = Object.freeze({
  "0115_payout_profiles_foundation.sql": [
    "organizations", "legal_entities", "bank_templates", "users",
  ],
  "0116_payout_ledger_foundation.sql": [
    "organizations", "payroll_runs", "payroll_entries", "employees", "payout_profiles",
  ],
  "0117_inline_first_payroll_journey.sql": ["organizations", "users"],
  "0118_wfm_roster_scale_rules.sql": [
    "organizations", "users", "employee_schedule_assignments", "employee_worksite_assignments",
  ],
  "0119_xendit_payout_provider.sql": [
    "payout_batches", "payout_transfers", "payout_batch_transfers", "payout_profiles",
  ],
  "0120_wfm_punch_evidence.sql": [
    "organizations", "users", "employees", "worksites", "time_punches",
  ],
  "0121_multi_entity_v2_scope_transfer.sql": [
    "organizations", "users", "legal_entities", "employees", "payroll_runs",
    "payroll_entries", "payslips", "payroll_jobs", "payout_batches",
    "payout_transfers", "bank_file_validations", "historical_payroll_entries",
    "year_end_adjustments", "separation_records", "user_organizations",
    "org_units", "job_profiles", "positions", "position_assignments",
    "worker_employment_events",
  ],
});

// These are proposed earlier outputs, NOT assertions that tables are applied.
export const CANONICAL_DRAFT_TABLE_CREATORS = Object.freeze({
  payout_profiles: "0115",
  payout_batches: "0116",
  payout_transfers: "0116",
  payout_batch_transfers: "0116",
});

const tableNames = [...new Set(Object.values(CANONICAL_MIGRATION_BASE_TABLES).flat())].sort();
/** All SQL identifiers are fixed source constants; no user input enters SQL. */
export const CANONICAL_MIGRATION_BASE_TABLES_SQL = [
  "SELECT requested.name AS table_name,",
  "  EXISTS (SELECT 1 FROM pg_catalog.pg_class c",
  "    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace",
  "    WHERE n.nspname='public' AND c.relname=requested.name",
  "      AND c.relkind IN ('r','p')) AS present",
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
    const migration = file.slice(0, 4);
    const fromEarlierDraft = name =>
      Object.hasOwn(CANONICAL_DRAFT_TABLE_CREATORS, name) &&
      CANONICAL_DRAFT_TABLE_CREATORS[name] < migration;
    const missingBaseTables = dependencies.filter(name =>
      found.get(name) !== true && !fromEarlierDraft(name));
    const pendingDraftPredecessors = dependencies.filter(name =>
      found.get(name) !== true && fromEarlierDraft(name));
    const structuralTargetsPresentOnly =
      missingBaseTables.length === 0 && pendingDraftPredecessors.length === 0;
    return {
      file,
      migration,
      missingBaseTables,
      pendingDraftPredecessors,
      structuralTargetsPresentOnly,
      status: missingBaseTables.length
        ? "BLOCKED_MISSING_BASE_TABLES"
        : pendingDraftPredecessors.length
          ? "ORDERED_DRAFT_DDL_UNAPPLIED_NOT_APPROVED"
          : "TARGET_TABLES_PRESENT_NOT_DDL_OR_RELEASE_APPROVAL",
    };
  });
  return {
    migrations,
    wholeTrainBaseTablesPresent: migrations.every(row => row.structuralTargetsPresentOnly),
    externalPredecessorsPresent: migrations.every(row => row.missingBaseTables.length === 0),
    requiresUnappliedDraftDDL: migrations.some(row => row.pendingDraftPredecessors.length > 0),
    productionMigrationApproved: false,
  };
}
