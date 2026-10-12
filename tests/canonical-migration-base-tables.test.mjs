import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_MIGRATION_BASE_TABLES,
  assessCanonicalMigrationTables,
} from "../scripts/lib/canonical-migration-base-tables.mjs";

const all = [...new Set(Object.values(CANONICAL_MIGRATION_BASE_TABLES).flat())];

function fixture(missing = []) {
  return all.map(name => ({table_name: name, present: !missing.includes(name)}));
}

test("actual Neon catalog signature separates roster/photo base tables from missing payout and history", () => {
  const assessed = assessCanonicalMigrationTables(fixture([
    "payout_batches","payout_transfers","payout_batch_transfers",
    "payout_profiles","worker_employment_events",
  ]));
  assert.deepEqual(assessed.migrations.map(r => [r.migration,r.status]), [
    ["0115","TARGET_TABLES_PRESENT_NOT_DDL_OR_RELEASE_APPROVAL"],
    ["0116","TARGET_TABLES_PRESENT_NOT_DDL_OR_RELEASE_APPROVAL"],
    ["0117","BLOCKED_MISSING_BASE_TABLES"],
    ["0118","TARGET_TABLES_PRESENT_NOT_DDL_OR_RELEASE_APPROVAL"],
    ["0119","BLOCKED_MISSING_BASE_TABLES"],
  ]);
  assert.deepEqual(assessed.migrations[2].missingBaseTables, [
    "payout_batches","payout_transfers","payout_batch_transfers","payout_profiles",
  ]);
  assert.deepEqual(assessed.migrations[4].missingBaseTables, [
    "payout_batches","payout_transfers","worker_employment_events",
  ]);
  assert.equal(assessed.wholeTrainBaseTablesPresent,false);
  assert.equal(assessed.productionMigrationApproved,false);
});

test("unknown, partial, duplicate and malformed inventory rows fail closed", () => {
  assert.throws(() => assessCanonicalMigrationTables(null), /unavailable/);
  assert.throws(() => assessCanonicalMigrationTables([null]), /inconsistent/);
  assert.throws(() => assessCanonicalMigrationTables([
    {table_name:"organizations",present:true},
    {table_name:"organizations",present:true},
  ]), /inconsistent/);
  assert.throws(() => assessCanonicalMigrationTables([
    {table_name:"a_user_supplied_name",present:true},
  ]), /inconsistent/);
  const missing = assessCanonicalMigrationTables([{table_name:"organizations",present:true}]);
  assert.equal(missing.wholeTrainBaseTablesPresent,false);
  assert.deepEqual(missing.migrations[0].missingBaseTables,["users"]);
});

test("even complete physical table inventory is not migration approval", () => {
  const result=assessCanonicalMigrationTables(fixture());
  assert.equal(result.wholeTrainBaseTablesPresent,true);
  assert.equal(result.productionMigrationApproved,false);
  assert.ok(result.migrations.every(m => m.status.endsWith("NOT_DDL_OR_RELEASE_APPROVAL")));
});
