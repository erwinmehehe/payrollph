/**
 * Catalog-only, non-authorizing readiness report for the proposed 0115–0121
 * release train. No database writes and no employee/bank/payroll row reads.
 *
 * Historical source paths or catalog presence cannot prove a migration ran.
 * This is NOT a migration executor or approval gate.
 */
export const TRAIN_STEPS = Object.freeze([
  {
    id: "0115", source: "drizzle/0115_payout_profiles_foundation.sql",
    requires: ["organizations", "legal_entities", "bank_templates", "users"],
    creates: ["payout_profiles"],
  },
  {
    id: "0116", source: "drizzle/0116_payout_ledger_foundation.sql",
    requires: ["organizations", "employees", "payroll_runs", "payroll_entries"],
    creates: ["payout_batches", "payout_transfers", "payout_batch_transfers"],
  },
  {
    id: "0117", source: "drizzle/0117_inline_first_payroll_journey.sql",
    requires: ["organizations", "users"],
    creates: ["first_payroll_journey_progress"],
  },
  {
    id: "0118", source: "drizzle/0118_wfm_roster_scale_rules.sql",
    requires: ["organizations", "users", "employee_schedule_assignments",
      "employee_worksite_assignments"],
    creates: ["workforce_roster_rule_policies"],
  },
  {
    id: "0119", source: "drizzle/0119_xendit_payout_provider.sql",
    requires: ["payout_batches", "payout_transfers",
      "payout_batch_transfers", "payout_profiles"],
    creates: [],
  },
  {
    id: "0120", source: "drizzle/0120_wfm_punch_evidence.sql",
    requires: ["organizations", "users", "employees", "worksites", "time_punches"],
    creates: ["worksite_punch_policies", "workforce_punch_photo_consents",
      "workforce_punch_photo_evidence", "workforce_punch_submissions"],
  },
  {
    id: "0121", source: "drizzle/0121_multi_entity_v2_scope_transfer.sql",
    requires: [
      "organizations", "users", "legal_entities", "employees", "payroll_runs",
      "payroll_entries", "payslips", "payroll_jobs", "payout_batches",
      "payout_transfers", "bank_file_validations", "historical_payroll_entries",
      "year_end_adjustments", "separation_records", "user_organizations",
      "org_units", "job_profiles", "positions", "position_assignments",
      "worker_employment_events",
    ],
    creates: ["user_legal_entity_grants", "user_entity_preferences",
      "employee_entity_assignments", "entity_transfer_requests"],
  },
]);

export const HISTORICAL_OBJECTS_TO_RECONCILE = Object.freeze([
  "provider_events", // historical 0110
  "workforce_demand_staffing_policies", // historical 0114
  "job_profiles", "positions", "position_assignments", // historical 0022
  "worker_employment_events", // historical 0050
]);

export const PREREQUISITE_CATALOG_SQL = [
  "SELECT table_name FROM information_schema.tables",
  "WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
  "ORDER BY table_name",
].join("\n");

export function assessTrainPrerequisites(tableNames, approvedReceipts = false) {
  if (!Array.isArray(tableNames) ||
      tableNames.some(name => typeof name !== "string" ||
        !/^[a-z_][a-z0-9_]*$/.test(name)) ||
      new Set(tableNames).size !== tableNames.length) {
    return {
      safeToApply: false, reason: "MISSING_CATALOG_EVIDENCE",
      perMigration: [], historicalMissing: [],
    };
  }
  const real = new Set(tableNames);
  const projected = new Set(tableNames);
  const projectedFrom = new Map();
  let allPredecessorsReady = true;
  const perMigration = TRAIN_STEPS.map(step => {
    const missing = step.requires.filter(name => !projected.has(name));
    const providedByEarlierDraft = step.requires
      .filter(name => !real.has(name) && projectedFrom.has(name))
      .map(name => ({ table: name, migration: projectedFrom.get(name) }));
    const blockedByPriorMigration = !allPredecessorsReady;
    const hypotheticalPreconditionsSatisfied = !blockedByPriorMigration &&
      missing.length === 0;
    if (hypotheticalPreconditionsSatisfied) {
      for (const name of step.creates) {
        if (!projected.has(name)) {
          projected.add(name);
          projectedFrom.set(name, step.id);
        }
      }
    } else {
      allPredecessorsReady = false;
    }
    return {
      migration: step.id,
      source: step.source,
      missing,
      providedByEarlierDraft,
      blockedByPriorMigration,
      hypotheticalPreconditionsSatisfied,
    };
  });
  const historicalMissing = HISTORICAL_OBJECTS_TO_RECONCILE
    .filter(name => !real.has(name));
  const immediateMissing = perMigration.some(step => step.missing.length > 0);
  return {
    safeToApply: false,
    prerequisitesPresent: !immediateMissing && historicalMissing.length === 0,
    receiptsReviewed: approvedReceipts === true,
    historicalMissing,
    reason: immediateMissing ? "MISSING_SQL_DEPENDENCIES"
      : historicalMissing.length ? "MISSING_HISTORICAL_OBJECTS"
      : approvedReceipts !== true ? "RECEIPTS_NOT_RECONCILED"
      : "CATALOG_ONLY_NOT_RELEASE_APPROVAL",
    perMigration,
  };
}
