import { test } from "node:test";
import assert from "node:assert/strict";
import { assessTrainPrerequisites, TRAIN_PREREQUISITES, PREREQUISITE_CATALOG_SQL }
  from "../scripts/lib/pending-train-preflight.mjs";

test("checks source SQL 0115-0119 table targets, not rows or credentials", () => {
  assert.deepEqual(Object.keys(TRAIN_PREREQUISITES), ["0115","0116","0117","0118","0119"]);
  assert.match(PREREQUISITE_CATALOG_SQL,/information_schema.tables/);
  assert.doesNotMatch(PREREQUISITE_CATALOG_SQL, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i);
});

test("live 112-table generation cannot apply 0117 or 0119 without payout prerequisites", () => {
  const names = [...new Set(Object.values(TRAIN_PREREQUISITES).flat())].filter(x =>
    !["payout_batches","payout_transfers","payout_batch_transfers","payout_profiles","worker_employment_events"].includes(x));
  const result=assessTrainPrerequisites(names);
  assert.equal(result.safeToApply,false);
  assert.equal(result.prerequisitesPresent,false);
  assert.deepEqual(result.perMigration.find(x=>x.migration==="0117").missing,
    ["payout_batches","payout_transfers","payout_batch_transfers","payout_profiles"]);
  assert.deepEqual(result.perMigration.find(x=>x.migration==="0119").missing,
    ["payout_batches","payout_transfers","worker_employment_events"]);
});

test("missing catalog and a complete catalog both fail closed", () => {
  assert.equal(assessTrainPrerequisites(null).safeToApply,false);
  const present=[...new Set(Object.values(TRAIN_PREREQUISITES).flat())];
  const reviewed=assessTrainPrerequisites(present,true);
  assert.equal(reviewed.prerequisitesPresent,true);
  assert.equal(reviewed.safeToApply,false);
  assert.equal(reviewed.reason,"CATALOG_ONLY_NOT_RELEASE_APPROVAL");
});
