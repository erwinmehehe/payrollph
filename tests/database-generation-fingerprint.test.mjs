import assert from "node:assert/strict";
import test from "node:test";
import {
  assessDatabaseGeneration,
} from "../scripts/lib/database-generation-fingerprint.mjs";

const old = {
  hasLegacyClients: true,
  hasOrganizations: false,
  hasLegacyPayrollLines: true,
  hasPayrollEntries: false,
  hasMigrationReceipts: false,
  hasMigrationJournal: false,
  hasMigrationCutover: false,
  usersIdType: "uuid",
  employeesIdType: "uuid",
  payrollRunsIdType: "uuid",
};
const app = {
  hasLegacyClients: false,
  hasOrganizations: true,
  hasLegacyPayrollLines: false,
  hasPayrollEntries: true,
  hasMigrationReceipts: true,
  hasMigrationJournal: true,
  hasMigrationCutover: true,
  hasPayoutBatches: true,
  hasPayoutTransfers: true,
  hasPayoutBatchTransfers: true,
  hasPayoutProfiles: true,
  hasProviderEvents: true,
  hasDemandStaffingPolicies: true,
  hasJobProfiles: true,
  hasPositions: true,
  hasPositionAssignments: true,
  hasWorkerEmploymentEvents: true,
  usersIdType: "integer",
  employeesIdType: "integer",
  payrollRunsIdType: "integer",
};

test("organization-integer catalog can never authorize production release", () => {
  const out=assessDatabaseGeneration(app);
  assert.equal(out.generation,"organization-integer");
  assert.equal(out.eligibleForMigrationReview,true);
  assert.equal(out.productionMigrationApproved,false);
});

test("legacy UUID/client signature rejects numbered forward migration", () => {
  const result = assessDatabaseGeneration(old);
  assert.equal(result.generation, "legacy-client-uuid");
  assert.equal(result.eligibleForMigrationReview, false);
  assert.equal(result.productionMigrationApproved, false);
});

test("wrong ID type or legacy coexistence is never silently accepted", () => {
  for (const bad of [
    { ...app, employeesIdType: "uuid" },
    { ...app, hasLegacyClients: true },
    { ...app, hasPayrollEntries: false },
    { ...old, hasOrganizations: true },
    {},
    null,
  ]) {
    assert.equal(assessDatabaseGeneration(bad).eligibleForMigrationReview, false);
  }
});

test("canonical shape without all reviewed migration journals fails closed", () => {
  for (const key of ["hasMigrationReceipts", "hasMigrationJournal", "hasMigrationCutover"]) {
    const result = assessDatabaseGeneration({ ...app, [key]: false });
    assert.equal(result.generation, "organization-integer");
    assert.equal(result.eligibleForMigrationReview, false);
    assert.equal(result.reason, "REQUIRED_REVIEWED_MIGRATION_JOURNALS_MISSING");
  }
});

test("even canonical catalog plus journal is review-only, not authorization", () => {
  const result = assessDatabaseGeneration(app);
  assert.equal(result.eligibleForMigrationReview, true);
  assert.equal(result.productionMigrationApproved, false);
  assert.match(result.reason, /DBA_RECEIPTS_AND_CLONE_REHEARSAL/);
});

test("observed Neon catalog distinguishes missing historical predecessor from proposed payout DDL", () => {
  const live = {
    ...app,
    hasMigrationReceipts: false,
    hasMigrationJournal: false,
    hasMigrationCutover: false,
    hasPayoutBatches: false,
    hasPayoutTransfers: false,
    hasPayoutBatchTransfers: false,
    hasPayoutProfiles: false,
    hasProviderEvents: false,
    hasDemandStaffingPolicies: false,
    hasJobProfiles: false,
    hasPositions: false,
    hasPositionAssignments: false,
    hasWorkerEmploymentEvents: false,
  };
  const result = assessDatabaseGeneration(live);
  assert.equal(result.generation, "organization-integer");
  assert.equal(result.reason, "NUMBERED_TRAIN_PREREQUISITES_MISSING");
  assert.deepEqual(result.missingTrainPrerequisites, [
    "provider_events", "workforce_demand_staffing_policies",
    "job_profiles", "positions", "position_assignments", "worker_employment_events",
  ]);
  assert.deepEqual(result.unappliedDraftTables, [
    "payout_profiles", "payout_batches", "payout_transfers", "payout_batch_transfers",
  ]);
  assert.equal(result.sourceMigrationSequenceRequired, true);
  assert.equal(result.eligibleForMigrationReview, false);
  assert.equal(result.productionMigrationApproved, false);
});

test("historical employment events remain an external gate even with reviewed journals", () => {
  const result = assessDatabaseGeneration({ ...app, hasWorkerEmploymentEvents: false });
  assert.deepEqual(result.missingTrainPrerequisites, ["worker_employment_events"]);
  assert.equal(result.eligibleForMigrationReview, false);
  assert.equal(result.reason, "NUMBERED_TRAIN_PREREQUISITES_MISSING");
  assert.equal(result.productionMigrationApproved, false);
});

test("payout tables belong to earlier unapplied draft steps, not the historical prerequisite set", () => {
  for (const key of [
    "hasPayoutProfiles", "hasPayoutBatches", "hasPayoutTransfers", "hasPayoutBatchTransfers",
  ]) {
    const result = assessDatabaseGeneration({ ...app, [key]: false });
    assert.deepEqual(result.missingTrainPrerequisites, []);
    assert.equal(result.unappliedDraftTables.length, 1);
    assert.equal(result.sourceMigrationSequenceRequired, true);
    assert.equal(result.eligibleForMigrationReview, true);
    assert.equal(result.productionMigrationApproved, false);
    assert.match(result.reason, /DBA_RECEIPTS_AND_CLONE_REHEARSAL/);
  }
});

test("complete catalog without approved migration journals is still held", () => {
  const result = assessDatabaseGeneration({
    ...app, hasMigrationReceipts: false, hasMigrationJournal: false, hasMigrationCutover: false,
  });
  assert.equal(result.eligibleForMigrationReview, false);
  assert.equal(result.productionMigrationApproved, false);
});

test("every historic SQL prerequisite independently blocks migration review", () => {
  for (const [flag, table] of [
    ["hasProviderEvents", "provider_events"],
    ["hasDemandStaffingPolicies", "workforce_demand_staffing_policies"],
    ["hasJobProfiles", "job_profiles"],
    ["hasPositions", "positions"],
    ["hasPositionAssignments", "position_assignments"],
    ["hasWorkerEmploymentEvents", "worker_employment_events"],
  ]) {
    const result = assessDatabaseGeneration({ ...app, [flag]: false });
    assert.deepEqual(result.missingTrainPrerequisites, [table]);
    assert.equal(result.eligibleForMigrationReview, false);
    assert.equal(result.productionMigrationApproved, false);
    assert.equal(result.reason, "NUMBERED_TRAIN_PREREQUISITES_MISSING");
  }
});
