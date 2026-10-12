import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const sqlDir = new URL("../drizzle/", import.meta.url);
const pending = new Map([
  [115, "0115_inline_first_payroll_journey.sql"],
  [116, "0116_wfm_roster_scale_rules.sql"],
  [117, "0117_xendit_payout_provider.sql"],
  [118, "0118_wfm_punch_evidence.sql"],
  [119, "0119_multi_entity_v2_scope_transfer.sql"],
]);

// Historical collisions are a separate adoption problem; never renumber them.
test("one canonical, contiguous pending migration per new number", () => {
  const names = readdirSync(sqlDir);
  const pendingFiles = names.filter((name) => /^011[5-9]_[a-z0-9_-]+\\.sql$/.test(name));
  assert.deepEqual(pendingFiles.sort(), [...pending.values()].sort());
  for (const [number, path] of pending) {
    assert.equal(Number(path.slice(0, 4)), number);
    assert.ok(readFileSync(new URL(path, sqlDir), "utf8").trim().length > 50);
  }
});

test("previous applied-history source files stay intact and out of the new train", () => {
  const names = readdirSync(sqlDir);
  for (const name of [
    "0112_wfm_operational_demand_observations.sql",
    "0113_wfm_issued_demand_forecasts.sql",
    "0114_wfm_demand_staffing_policies.sql",
  ]) assert.ok(names.includes(name), "historical migration missing: " + name);
  assert.ok(!names.includes("0112_wfm_punch_evidence.sql"));
});

test("feature-specific SQL remains source-gated and no payout or employer transfer is executed", () => {
  const xendit = readFileSync(new URL(pending.get(117), sqlDir), "utf8");
  assert.match(xendit, /ALTER TABLE "payout_batches"/);
  assert.match(xendit, /DEFAULT 'paymongo'/);
  const multi = readFileSync(new URL(pending.get(119), sqlDir), "utf8");
  assert.match(multi, /UPDATE payroll_entries/);
  assert.match(multi, /COMMIT;/);
  assert.ok(!/\\b(?:TRUNCATE|DROP TABLE)\\b/i.test(multi));
  const docs = readFileSync(new URL("../docs/engineering/pending-migration-release-train.md", import.meta.url), "utf8");
  assert.match(docs, /DO NOT RUN ON NEON/);
  assert.match(docs, /runtime DDL/);
});
