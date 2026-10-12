import assert from "node:assert/strict";
import test from "node:test";
import {
  assessDatabaseGeneration, DATABASE_GENERATION_FINGERPRINT_SQL,
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
  usersIdType: "integer",
  employeesIdType: "integer",
  payrollRunsIdType: "integer",
};

test("read-only fingerprint inspects PostgreSQL catalog metadata only", () => {
  assert.match(DATABASE_GENERATION_FINGERPRINT_SQL, /information_schema\.columns/);
  assert.match(DATABASE_GENERATION_FINGERPRINT_SQL, /to_regclass\('public\.organizations'\)/);
  assert.doesNotMatch(DATABASE_GENERATION_FINGERPRINT_SQL, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);
});

test("connected legacy UUID/client signature rejects numbered forward migration", () => {
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
