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

test("observed correct Neon app schema blocks the train until source prerequisites exist", () => {
  const live = {
    ...app,
    hasMigrationReceipts: false,
    hasMigrationJournal: false,
    hasMigrationCutover: false,
    hasPayoutBatches: false,
    hasPayoutTransfers: false,
    hasPayoutBatchTransfers: false,
    hasPayoutProfiles: false,
    hasWorkerEmploymentEvents: false,
  };
  const outcome = assessDatabaseGeneration(live);
  assert.equal(outcome.generation, "organization-integer");
  assert.equal(outcome.reason, "NUMBERED_TRAIN_PREREQUISITES_MISSING");
  assert.deepEqual(outcome.missingTrainPrerequisites, [
    "payout_batches", "payout_transfers", "payout_batch_transfers",
    "payout_profiles", "worker_employment_events",
  ]);
  assert.equal(outcome.eligibleForMigrationReview, false);
  assert.equal(outcome.productionMigrationApproved, false);
});

test("one missing source prerequisite blocks migration review despite journals", () => {
  const outcome = assessDatabaseGeneration({ ...app, hasPayoutBatches: false });
  assert.deepEqual(outcome.missingTrainPrerequisites, ["payout_batches"]);
  assert.equal(outcome.eligibleForMigrationReview, false);
  assert.equal(outcome.reason, "NUMBERED_TRAIN_PREREQUISITES_MISSING");
});

test("each payout and worker-history table separately blocks numbered migration review when absent", () => {
  for (const key of [
    "hasPayoutBatches", "hasPayoutTransfers", "hasPayoutBatchTransfers",
    "hasPayoutProfiles", "hasWorkerEmploymentEvents",
  ]) {
    const out=assessDatabaseGeneration({...app,[key]:false});
    assert.equal(out.eligibleForMigrationReview,false);
    assert.equal(out.reason,"NUMBERED_TRAIN_PREREQUISITES_MISSING");
    assert.equal(out.productionMigrationApproved,false);
  }
});
