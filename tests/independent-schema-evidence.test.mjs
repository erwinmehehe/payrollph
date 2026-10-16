import assert from "node:assert/strict";
import test from "node:test";
import { classifyAtlasDiff, classifySquawkReport } from "../scripts/lib/independent-schema-evidence.mjs";

test("Atlas plain empty SQL plan is PASS, not false drift", () => {
  assert.equal(classifyAtlasDiff("").status, "PASS");
  assert.equal(classifyAtlasDiff("   \n").status, "PASS");
});
test("Atlas only accepts exact no-change notice; never disguises DDL", () => {
  assert.equal(classifyAtlasDiff("Schemas are synced, no changes to be made.\n").status, "PASS");
  assert.equal(classifyAtlasDiff("ALTER TABLE public.open_shifts DROP CONSTRAINT x;").status, "DRIFT");
  assert.equal(classifyAtlasDiff("Schemas are synced, no changes to be made.\nALTER TABLE x DROP y;").status, "DRIFT");
  assert.equal(classifyAtlasDiff("Unexpected Atlas output").status, "DRIFT");
  assert.throws(() => classifyAtlasDiff(null), /text/);
});
test("Squawk empty JSON array with zero exit passes", () => {
  const result = classifySquawkReport("[]\n", 0);
  assert.deepEqual([result.status, result.findingCount, result.exitCode], ["PASS", 0, 0]);
});
test("Squawk warnings remain blocking with per-rule evidence", () => {
  const report = JSON.stringify([{
    file: "drizzle/0125_wfm_availability_open_shifts_forward_repair.sql",
    line: 5, column: 1, level: "Warning",
    rule_name: "require-lock-timeout", message: "Potential lock", help: null,
  }]);
  const result = classifySquawkReport(report, 0);
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.byRule["require-lock-timeout"], 1);
  assert.equal(result.bySeverity.Warning, 1);
});
test("Squawk nonzero exit and malformed or missing reports fail closed", () => {
  assert.equal(classifySquawkReport("[]", 1).status, "BLOCKED");
  assert.throws(() => classifySquawkReport("", 0), /missing/);
  assert.throws(() => classifySquawkReport("not json", 0), /parsed/);
  assert.throws(() => classifySquawkReport("{}", 0), /format/);
  assert.throws(() => classifySquawkReport('[{"file":"test.sql"}]', 0), /shape/);
  assert.throws(() => classifySquawkReport("[]", NaN), /code/);
});
