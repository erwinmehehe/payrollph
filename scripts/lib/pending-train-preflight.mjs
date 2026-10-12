/** Fail-closed, catalog-only preflight for the proposed 0115-0119 train.
 * This checks immediate target relations, not historical migration receipts.
 * It never authorizes application or queries sensitive records.
 */
export const TRAIN_PREREQUISITES = Object.freeze({
  "0115": ["organizations", "users"],
  "0116": ["organizations", "users", "employee_schedule_assignments", "employee_worksite_assignments"],
  "0117": ["payout_batches", "payout_transfers", "payout_batch_transfers", "payout_profiles"],
  "0118": ["organizations", "users", "employees", "worksites", "time_punches"],
  "0119": ["organizations", "users", "legal_entities", "employees", "payroll_runs",
    "payroll_entries", "payslips", "payroll_jobs", "payout_batches", "payout_transfers",
    "bank_file_validations", "historical_payroll_entries", "year_end_adjustments",
    "separation_records", "user_organizations", "org_units", "worker_employment_events"],
});

export const PREREQUISITE_CATALOG_SQL = [
  "SELECT table_name FROM information_schema.tables",
  "WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
  "ORDER BY table_name",
].join("\n");

export function assessTrainPrerequisites(tableNames, approvedReceipts = false) {
  if (!Array.isArray(tableNames) || !tableNames.every(x => typeof x === "string")) {
    return { safeToApply: false, reason: "MISSING_CATALOG_EVIDENCE", perMigration: [] };
  }
  const existing = new Set(tableNames);
  const perMigration = Object.entries(TRAIN_PREREQUISITES).map(([migration, required]) => ({
    migration, missing: required.filter(x => !existing.has(x)),
  }));
  const missing = perMigration.some(x => x.missing.length > 0);
  return {
    safeToApply: false, // Source metadata is never independent release authorization.
    prerequisitesPresent: !missing,
    receiptsReviewed: approvedReceipts === true,
    reason: missing ? "MISSING_SQL_DEPENDENCIES"
      : approvedReceipts !== true ? "RECEIPTS_NOT_RECONCILED"
      : "CATALOG_ONLY_NOT_RELEASE_APPROVAL",
    perMigration,
  };
}
