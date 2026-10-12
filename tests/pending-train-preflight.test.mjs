import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  TRAIN_STEPS, HISTORICAL_OBJECTS_TO_RECONCILE,
  PREREQUISITE_CATALOG_SQL, assessTrainPrerequisites,
} from "../scripts/lib/pending-train-preflight.mjs";

const sourceKeys = [
  "0115","0116","0117","0118","0119","0120","0121",
];
const expectedMissingHistorical = [
  "provider_events","workforce_demand_staffing_policies","job_profiles",
  "positions","position_assignments","worker_employment_events",
];
const syntheticBaseline = () => {
  const required = new Set(TRAIN_STEPS.flatMap(s => s.requires));
  for (const step of TRAIN_STEPS) {
    for (const created of step.creates) required.delete(created);
  }
  for (const hist of expectedMissingHistorical) required.delete(hist);
  return [...required];
};

test("catalog-only inventory is SELECT-only and proposed SQL filenames match 0115–0121", () => {
  assert.deepEqual(TRAIN_STEPS.map(s => s.id), sourceKeys);
  assert.match(PREREQUISITE_CATALOG_SQL, /information_schema.tables/);
  assert.doesNotMatch(PREREQUISITE_CATALOG_SQL,
    /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|EXECUTE)\b/i);
  for (const step of TRAIN_STEPS) {
    assert.match(step.source, new RegExp("^drizzle/" + step.id + "_"));
    assert.ok(readFileSync(new URL("../"+step.source,import.meta.url),"utf8").length > 200);
  }
});

test("correct Neon-type baseline: 0115/16 foundations are possible in isolation, 0119 depends on them", () => {
  const result = assessTrainPrerequisites(syntheticBaseline());
  assert.equal(result.safeToApply, false);
  assert.equal(result.prerequisitesPresent, false);
  assert.equal(result.reason, "MISSING_SQL_DEPENDENCIES");
  for (const n of ["0115","0116","0117","0118","0119","0120"]) {
    assert.deepEqual(result.perMigration.find(x=>x.migration===n).missing, []);
  }
  const xendit = result.perMigration.find(x=>x.migration === "0119");
  assert.deepEqual(xendit.providedByEarlierDraft, [
    {table:"payout_batches",migration:"0116"},
    {table:"payout_transfers",migration:"0116"},
    {table:"payout_batch_transfers",migration:"0116"},
    {table:"payout_profiles",migration:"0115"},
  ]);
  assert.deepEqual(result.perMigration.find(x=>x.migration==="0121").missing, [
    "job_profiles","positions","position_assignments","worker_employment_events",
  ]);
  assert.deepEqual(result.historicalMissing, expectedMissingHistorical);
});

test("if foundation prerequisites are missing, later source output cannot be projected as applied", () => {
  const baseline = syntheticBaseline().filter(x=>x!=="bank_templates");
  const result = assessTrainPrerequisites(baseline);
  const foundation = result.perMigration.find(x=>x.migration==="0115");
  assert.deepEqual(foundation.missing, ["bank_templates"]);
  assert.equal(foundation.hypotheticalPreconditionsSatisfied,false);
  assert.equal(result.perMigration.find(x=>x.migration==="0116").blockedByPriorMigration,true);
  const xendit = result.perMigration.find(x=>x.migration==="0119");
  assert.deepEqual(xendit.missing, [
    "payout_batches","payout_transfers","payout_batch_transfers","payout_profiles",
  ]);
  assert.deepEqual(xendit.providedByEarlierDraft,[]);
});

test("complete hypothetical catalog and invented approval receipts still never authorize apply", () => {
  const complete = [...new Set([...syntheticBaseline(),...HISTORICAL_OBJECTS_TO_RECONCILE])];
  const result=assessTrainPrerequisites(complete,true);
  assert.equal(result.prerequisitesPresent,true);
  assert.equal(result.safeToApply,false);
  assert.equal(result.reason,"CATALOG_ONLY_NOT_RELEASE_APPROVAL");
  assert.equal(result.receiptsReviewed,true);
});

test("corrupt/ambiguous missing catalog output fails closed", () => {
  for (const bad of [null,undefined,[1],["a","a"],["unexpected.table"],
    ["payroll-runs"]]) {
    const result=assessTrainPrerequisites(bad);
    assert.equal(result.safeToApply,false);
    assert.equal(result.reason,"MISSING_CATALOG_EVIDENCE");
    assert.deepEqual(result.perMigration,[]);
  }
});

test("historical 0022 and 0050 are real source dependencies, not proof they ran", () => {
  const job=readFileSync(new URL("../drizzle/0022_job_architecture_positions.sql",import.meta.url),"utf8");
  const worker=readFileSync(new URL("../drizzle/0050_hcm_core_worker_history.sql",import.meta.url),"utf8");
  assert.match(job,/CREATE TABLE IF NOT EXISTS "job_profiles"/);
  assert.match(job,/CREATE TABLE IF NOT EXISTS "positions"/);
  assert.match(job,/CREATE TABLE IF NOT EXISTS "position_assignments"/);
  assert.match(worker,/CREATE TABLE IF NOT EXISTS "worker_employment_events"/);
});
