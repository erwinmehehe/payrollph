/**
 * Read-only catalog fingerprint used to reject the legacy UUID/client schema
 * before anyone attempts the current app's integer/organization migrations.
 * No query reads row contents, credentials, payroll or banking data.
 */
// Source constants only. A VIEW or foreign table is not a base table
// prerequisite for the ordered SQL migration train.
function publicBaseTableFlag(table, alias) {
  if (!/^[a-z_][a-z0-9_]*$/.test(table) ||
      !/^[A-Za-z][A-Za-z0-9]*$/.test(alias)) {
    throw new Error("UNSAFE_STATIC_CATALOG_IDENTIFIER");
  }
  return `  EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='${table}' AND c.relkind IN ('r','p')) AS "${alias}",`;
}

function publicIdType(table, alias) {
  return `  (SELECT pg_catalog.format_type(a.atttypid,a.atttypmod) FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='${table}' AND c.relkind IN ('r','p') AND a.attname='id' AND a.attnum>0 AND NOT a.attisdropped) AS "${alias}"`;
}

export const DATABASE_GENERATION_FINGERPRINT_SQL = [
  "SELECT",
  "  current_database() AS \"databaseName\",",
  "  current_setting('server_version_num')::integer AS \"serverVersionNum\",",
  "  (SELECT count(*)::integer FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace",
  "   WHERE n.nspname = 'public' AND c.relkind IN ('r','p')) AS \"publicTableCount\",",
  publicBaseTableFlag("clients", "hasLegacyClients"),
  publicBaseTableFlag("organizations", "hasOrganizations"),
  publicBaseTableFlag("payroll_lines", "hasLegacyPayrollLines"),
  publicBaseTableFlag("payroll_entries", "hasPayrollEntries"),
  publicBaseTableFlag("payrollph_release_migration_receipts", "hasMigrationReceipts"),
  publicBaseTableFlag("payrollph_schema_migrations", "hasMigrationJournal"),
  publicBaseTableFlag("payrollph_migration_cutover", "hasMigrationCutover"),
  publicBaseTableFlag("payout_batches", "hasPayoutBatches"),
  publicBaseTableFlag("payout_transfers", "hasPayoutTransfers"),
  publicBaseTableFlag("payout_batch_transfers", "hasPayoutBatchTransfers"),
  publicBaseTableFlag("payout_profiles", "hasPayoutProfiles"),
  publicBaseTableFlag("provider_events", "hasProviderEvents"),
  publicBaseTableFlag("workforce_demand_staffing_policies", "hasDemandStaffingPolicies"),
  publicBaseTableFlag("job_profiles", "hasJobProfiles"),
  publicBaseTableFlag("positions", "hasPositions"),
  publicBaseTableFlag("position_assignments", "hasPositionAssignments"),
  publicBaseTableFlag("worker_employment_events", "hasWorkerEmploymentEvents"),
  publicIdType("users", "usersIdType") + ",",
  publicIdType("employees", "employeesIdType") + ",",
  publicIdType("payroll_runs", "payrollRunsIdType"),
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
    // Current seven-step draft train: 0115 proposes payout_profiles; 0116
    // proposes payout_batches/transfers/links. Their absence on main is NOT
    // proof that 0119 is an independently executable migration. Record as
    // unapplied SOURCE DDL, never fabricate table-existence receipts.
    const proposedDraftTables = [
      ["payout_profiles", row.hasPayoutProfiles],
      ["payout_batches", row.hasPayoutBatches],
      ["payout_transfers", row.hasPayoutTransfers],
      ["payout_batch_transfers", row.hasPayoutBatchTransfers],
    ];
    const unappliedDraftTables = proposedDraftTables
      .filter(([, exists]) => exists !== true).map(([name]) => name);
    // Canonical #865 has six historic source prerequisites. None of these
    // objects is newly created by its 0115-0121 SQL. Their absence blocks
    // even preliminary migration review regardless of payout draft ordering.
    const historicalPrerequisites = [
      ["provider_events", row.hasProviderEvents],
      ["workforce_demand_staffing_policies", row.hasDemandStaffingPolicies],
      ["job_profiles", row.hasJobProfiles],
      ["positions", row.hasPositions],
      ["position_assignments", row.hasPositionAssignments],
      ["worker_employment_events", row.hasWorkerEmploymentEvents],
    ];
    const missingTrainPrerequisites = historicalPrerequisites
      .filter(([, exists]) => exists !== true).map(([name]) => name);
    const journalReady = row.hasMigrationReceipts === true &&
      row.hasMigrationJournal === true && row.hasMigrationCutover === true;
    return {
      generation: "organization-integer",
      missingTrainPrerequisites,
      unappliedDraftTables,
      sourceMigrationSequenceRequired: unappliedDraftTables.length > 0,
      // Review-only; never signals permission to run SQL on a live database.
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
