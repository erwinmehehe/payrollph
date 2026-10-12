import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_MIGRATION_BASE_TABLES,
  CANONICAL_MIGRATION_BASE_TABLES_SQL,
  CANONICAL_DRAFT_TABLE_CREATORS,
  assessCanonicalMigrationTables,
} from "../scripts/lib/canonical-migration-base-tables.mjs";

const all = [...new Set(Object.values(CANONICAL_MIGRATION_BASE_TABLES).flat())];
const absentOnOriginalNeon = [
  "payout_batches", "payout_transfers", "payout_batch_transfers",
  "payout_profiles", "job_profiles", "positions", "position_assignments",
  "worker_employment_events",
];
function fixture(missing = []) {
  return all.map(name => ({ table_name: name, present: !missing.includes(name) }));
}

test("tracks seven canonical 0115-0121 draft files and records earlier source creations", () => {
  assert.deepEqual(Object.keys(CANONICAL_MIGRATION_BASE_TABLES), [
    "0115_payout_profiles_foundation.sql",
    "0116_payout_ledger_foundation.sql",
    "0117_inline_first_payroll_journey.sql",
    "0118_wfm_roster_scale_rules.sql",
    "0119_xendit_payout_provider.sql",
    "0120_wfm_punch_evidence.sql",
    "0121_multi_entity_v2_scope_transfer.sql",
  ]);
  assert.deepEqual(CANONICAL_DRAFT_TABLE_CREATORS, {
    payout_profiles: "0115",
    payout_batches: "0116",
    payout_transfers: "0116",
    payout_batch_transfers: "0116",
  });
});

test("missing historic worker events block 0121; proposed payout tables are unapplied draft predecessors", () => {
  const assessed = assessCanonicalMigrationTables(fixture(absentOnOriginalNeon));
  assert.deepEqual(assessed.migrations.map(r => [r.migration, r.status]), [
    ["0115", "TARGET_TABLES_PRESENT_NOT_DDL_OR_RELEASE_APPROVAL"],
    ["0116", "ORDERED_DRAFT_DDL_UNAPPLIED_NOT_APPROVED"],
    ["0117", "TARGET_TABLES_PRESENT_NOT_DDL_OR_RELEASE_APPROVAL"],
    ["0118", "TARGET_TABLES_PRESENT_NOT_DDL_OR_RELEASE_APPROVAL"],
    ["0119", "ORDERED_DRAFT_DDL_UNAPPLIED_NOT_APPROVED"],
    ["0120", "TARGET_TABLES_PRESENT_NOT_DDL_OR_RELEASE_APPROVAL"],
    ["0121", "BLOCKED_MISSING_BASE_TABLES"],
  ]);
  assert.deepEqual(assessed.migrations[1].pendingDraftPredecessors, ["payout_profiles"]);
  assert.deepEqual(assessed.migrations[4].pendingDraftPredecessors, [
    "payout_batches", "payout_transfers", "payout_batch_transfers", "payout_profiles",
  ]);
  assert.deepEqual(assessed.migrations[6].missingBaseTables, [
    "job_profiles", "positions", "position_assignments", "worker_employment_events",
  ]);
  assert.deepEqual(assessed.migrations[6].pendingDraftPredecessors, [
    "payout_batches", "payout_transfers",
  ]);
  assert.equal(assessed.wholeTrainBaseTablesPresent, false);
  assert.equal(assessed.externalPredecessorsPresent, false);
  assert.equal(assessed.requiresUnappliedDraftDDL, true);
  assert.equal(assessed.productionMigrationApproved, false);
});

test("unknown, partial, duplicate and malformed inventory rows fail closed", () => {
  assert.throws(() => assessCanonicalMigrationTables(null), /unavailable/);
  assert.throws(() => assessCanonicalMigrationTables([null]), /inconsistent/);
  assert.throws(() => assessCanonicalMigrationTables([
    { table_name: "organizations", present: true },
    { table_name: "organizations", present: true },
  ]), /inconsistent/);
  assert.throws(() => assessCanonicalMigrationTables([
    { table_name: "a_user_supplied_name", present: true },
  ]), /inconsistent/);
  const missing = assessCanonicalMigrationTables([{ table_name: "organizations", present: true }]);
  assert.equal(missing.wholeTrainBaseTablesPresent, false);
  assert.ok(missing.migrations[0].missingBaseTables.includes("legal_entities"));
  assert.equal(missing.productionMigrationApproved, false);
});

test("unapplied source-created predecessors are not treated as existing database tables", () => {
  const result = assessCanonicalMigrationTables(fixture([
    "payout_batches", "payout_transfers", "payout_batch_transfers", "payout_profiles",
  ]));
  assert.equal(result.externalPredecessorsPresent, true);
  assert.equal(result.requiresUnappliedDraftDDL, true);
  assert.equal(result.wholeTrainBaseTablesPresent, false);
  assert.equal(result.productionMigrationApproved, false);
});

test("even complete physical table inventory is not migration approval", () => {
  const result = assessCanonicalMigrationTables(fixture());
  assert.equal(result.wholeTrainBaseTablesPresent, true);
  assert.equal(result.requiresUnappliedDraftDDL, false);
  assert.equal(result.productionMigrationApproved, false);
  assert.ok(result.migrations.every(m => m.status.endsWith("NOT_DDL_OR_RELEASE_APPROVAL")));
});

test("catalog predicate checks actual base tables, never a similarly named view", () => {
  assert.match(CANONICAL_MIGRATION_BASE_TABLES_SQL, /pg_catalog\.pg_class/);
  assert.match(CANONICAL_MIGRATION_BASE_TABLES_SQL, /relkind IN \('r','p'\)/);
  assert.doesNotMatch(CANONICAL_MIGRATION_BASE_TABLES_SQL, /to_regclass/);
});
