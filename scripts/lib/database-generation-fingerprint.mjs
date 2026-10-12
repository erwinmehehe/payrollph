/**
 * Read-only catalog fingerprint used to reject the legacy UUID/client schema
 * before anyone attempts the current app's integer/organization migrations.
 * No query reads row contents, credentials, payroll or banking data.
 */
export const DATABASE_GENERATION_FINGERPRINT_SQL = [
  "SELECT",
  "  current_database() AS \"databaseName\",",
  "  current_setting('server_version_num')::integer AS \"serverVersionNum\",",
  "  (SELECT count(*)::integer FROM information_schema.tables",
  "   WHERE table_schema = 'public' AND table_type = 'BASE TABLE') AS \"publicTableCount\",",
  "  to_regclass('public.clients') IS NOT NULL AS \"hasLegacyClients\",",
  "  to_regclass('public.organizations') IS NOT NULL AS \"hasOrganizations\",",
  "  to_regclass('public.payroll_lines') IS NOT NULL AS \"hasLegacyPayrollLines\",",
  "  to_regclass('public.payroll_entries') IS NOT NULL AS \"hasPayrollEntries\",",
  "  to_regclass('public.payrollph_release_migration_receipts') IS NOT NULL AS \"hasMigrationReceipts\",",
  "  to_regclass('public.payrollph_schema_migrations') IS NOT NULL AS \"hasMigrationJournal\",",
  "  to_regclass('public.payrollph_migration_cutover') IS NOT NULL AS \"hasMigrationCutover\",",
  "  to_regclass('public.payout_batches') IS NOT NULL AS \"hasPayoutBatches\",",
  "  to_regclass('public.payout_transfers') IS NOT NULL AS \"hasPayoutTransfers\",",
  "  to_regclass('public.payout_batch_transfers') IS NOT NULL AS \"hasPayoutBatchTransfers\",",
  "  to_regclass('public.payout_profiles') IS NOT NULL AS \"hasPayoutProfiles\",",
  "  to_regclass('public.worker_employment_events') IS NOT NULL AS \"hasWorkerEmploymentEvents\",",
  "  (SELECT data_type FROM information_schema.columns",
  "   WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'id') AS \"usersIdType\",",
  "  (SELECT data_type FROM information_schema.columns",
  "   WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'id') AS \"employeesIdType\",",
  "  (SELECT data_type FROM information_schema.columns",
  "   WHERE table_schema = 'public' AND table_name = 'payroll_runs' AND column_name = 'id') AS \"payrollRunsIdType\"",
].join("\n");

const isUuid = (type) => type === "uuid";
const isInteger = (type) => type === "integer";

/** Fail closed on mixed, unknown, unaudited or partially adopted schemas. */
export function assessDatabaseGeneration(row) {
  if (!row || typeof row !== "object") {
    return {
      generation: "unknown",
      eligibleForMigrationReview: false,
      productionMigrationApproved: false,
      reason: "DATABASE_FINGERPRINT_UNAVAILABLE",
    };
  }
  const legacy = row.hasLegacyClients === true &&
    row.hasLegacyPayrollLines === true &&
    row.hasOrganizations === false &&
    row.hasPayrollEntries === false &&
    [row.usersIdType, row.employeesIdType, row.payrollRunsIdType].every(isUuid);
  if (legacy) {
    return {
      generation: "legacy-client-uuid",
      eligibleForMigrationReview: false,
      productionMigrationApproved: false,
      reason: "LEGACY_UUID_SCHEMA_REQUIRES_SEPARATE_TARGET_AND_RECONCILED_DATA_MIGRATION",
    };
  }

  const currentAppShape = row.hasOrganizations === true &&
    row.hasPayrollEntries === true &&
    [row.usersIdType, row.employeesIdType, row.payrollRunsIdType].every(isInteger) &&
    row.hasLegacyClients === false;
  if (currentAppShape) {
    // Proposed #865 SQL 0117 and 0119 reference these pre-existing objects.
    // A missing one makes the numbered train unsafe to execute as written.
    const sourcePrerequisites = [
      ["payout_batches", row.hasPayoutBatches],
      ["payout_transfers", row.hasPayoutTransfers],
      ["payout_batch_transfers", row.hasPayoutBatchTransfers],
      ["payout_profiles", row.hasPayoutProfiles],
      ["worker_employment_events", row.hasWorkerEmploymentEvents],
    ];
    const missingTrainPrerequisites = sourcePrerequisites
      .filter(([, exists]) => exists !== true).map(([name]) => name);
    const journalReady = row.hasMigrationReceipts === true &&
      row.hasMigrationJournal === true && row.hasMigrationCutover === true;
    return {
      generation: "organization-integer",
      missingTrainPrerequisites,
      eligibleForMigrationReview: journalReady && missingTrainPrerequisites.length === 0,
      productionMigrationApproved: false,
      reason: missingTrainPrerequisites.length
        ? "NUMBERED_TRAIN_PREREQUISITES_MISSING"
        : journalReady
          ? "CATALOG_SHAPE_ONLY_REQUIRES_DBA_RECEIPTS_AND_CLONE_REHEARSAL"
          : "REQUIRED_REVIEWED_MIGRATION_JOURNALS_MISSING",
    };
  }

  return {
    generation: "unknown-or-mixed",
    eligibleForMigrationReview: false,
    productionMigrationApproved: false,
    reason: "UNRECOGNIZED_OR_MIXED_SCHEMA_REFUSE_MIGRATION",
  };
}
