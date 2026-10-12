import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { assessTrainPrerequisites, TRAIN_STEPS } from "../scripts/lib/pending-train-preflight.mjs";

const sqlDir = new URL("../drizzle/", import.meta.url);
const pending = new Map([
  [115, "0115_payout_profiles_foundation.sql"],
  [116, "0116_payout_ledger_foundation.sql"],
  [117, "0117_inline_first_payroll_journey.sql"],
  [118, "0118_wfm_roster_scale_rules.sql"],
  [119, "0119_xendit_payout_provider.sql"],
  [120, "0120_wfm_punch_evidence.sql"],
  [121, "0121_multi_entity_v2_scope_transfer.sql"],
]);

test("one canonical dependency-ordered contiguous draft migration per number 0115-0121", () => {
  const names = readdirSync(sqlDir);
  const draft = names.filter(name => /^01(?:1[5-9]|2[01])_[a-z0-9_-]+\.sql$/.test(name));
  assert.deepEqual(draft.sort(), [...pending.values()].sort());
  const numbers = draft.map(f => Number(f.slice(0,4)));
  assert.deepEqual(numbers.sort((a,b)=>a-b), [115,116,117,118,119,120,121]);
  for (const [number,name] of pending) {
    assert.equal(Number(name.slice(0,4)), number);
    assert.ok(readFileSync(new URL(name, sqlDir), "utf8").trim().length > 200, name);
  }
});

test("historical SQL remains intact and number collisions stay out of the draft train", () => {
  const names = readdirSync(sqlDir);
  for (const f of [
    "0074_company_payout_profiles.sql",
    "0110_provider_events_inbox.sql",
    "0112_wfm_operational_demand_observations.sql",
    "0113_wfm_issued_demand_forecasts.sql",
    "0114_wfm_demand_staffing_policies.sql",
  ]) assert.ok(names.includes(f), "historical file must remain: "+f);
  assert.ok(!names.includes("0112_wfm_punch_evidence.sql"));
  assert.ok(!names.includes("0115_inline_first_payroll_journey.sql"));
  assert.ok(!names.includes("0117_xendit_payout_provider.sql"));
});

test("payout foundations precede Xendit without enabling provider submission", () => {
  const profiles = readFileSync(new URL(pending.get(115),sqlDir), "utf8");
  const ledger = readFileSync(new URL(pending.get(116),sqlDir), "utf8");
  const xendit = readFileSync(new URL(pending.get(119),sqlDir), "utf8");
  assert.match(profiles,/CREATE TABLE IF NOT EXISTS "payout_profiles"/);
  assert.match(profiles,/validate_payout_profile_tenant_scope/);
  assert.match(profiles,/DEFAULT 'bank_file'/);
  assert.match(profiles,/DEFAULT false/);
  assert.match(ledger,/CREATE TABLE IF NOT EXISTS payout_batches/);
  assert.match(ledger,/CREATE TABLE IF NOT EXISTS payout_transfers/);
  assert.match(ledger,/CREATE TABLE IF NOT EXISTS payout_batch_transfers/);
  assert.match(ledger,/validate_payout_transfer_scope/);
  assert.match(ledger,/validate_payout_batch_transfer_scope/);
  assert.match(ledger,/DEFAULT 'prepared'/);
  assert.match(xendit,/ALTER TABLE "payout_batches"/);
  assert.match(xendit,/ALTER TABLE "payout_profiles"/);
  assert.match(xendit,/DEFAULT 'paymongo'/);
  for (const source of [profiles,ledger,xendit]) {
    assert.doesNotMatch(source, /^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/m);
  }
});

test("historical employment prerequisite cannot be inferred from draft migrations", () => {
  const available = new Set(TRAIN_STEPS.flatMap(step => step.requires));
  for (const step of TRAIN_STEPS) {
    for (const generated of step.creates) available.delete(generated);
  }
  available.delete("worker_employment_events");
  const assessment = assessTrainPrerequisites([...available], true);
  const entityTransfer = assessment.perMigration.find(row => row.migration === "0121");
  assert.equal(entityTransfer.hypotheticalPreconditionsSatisfied, false);
  assert.ok(entityTransfer.missing.includes("worker_employment_events"));
  assert.equal(assessment.safeToApply, false);
  assert.equal(assessment.prerequisitesPresent, false);
  assert.equal(assessment.reason, "MISSING_SQL_DEPENDENCIES");
});
