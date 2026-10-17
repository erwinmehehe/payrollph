import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  DEV_DEMO_PAYROLL_WORKERS, fictionalDevSeedPayroll,
} from "../src/lib/dev-demo-payroll-fixture";

const EXPECTED_FICTIONAL_TOTALS = [
  { period: "processing", gross: "258800.00", net: "209664.00" },
  { period: "released", gross: "250800.00", net: "203190.00" },
] as const;

test("legacy fictional eight-worker seed headers reconcile to every employee detail", () => {
  for (const expected of EXPECTED_FICTIONAL_TOTALS) {
    const run = fictionalDevSeedPayroll(expected.period);
    assert.equal(run.entries.length, DEV_DEMO_PAYROLL_WORKERS);
    assert.equal(run.grossPay, expected.gross);
    assert.equal(run.netPay, expected.net);
    const grossCentavos = run.entries.reduce((sum, row) => sum + row.gross * 100, 0);
    const deductionCentavos = run.entries.reduce((sum, row) => sum + row.deductions * 100, 0);
    const netCentavos = run.entries.reduce((sum, row) => {
      assert.equal(row.gross - row.deductions, row.net);
      return sum + row.net * 100;
    }, 0);
    assert.equal(grossCentavos, Number(run.grossPay) * 100);
    assert.equal(netCentavos, Number(run.netPay) * 100);
    assert.equal(grossCentavos - deductionCentavos, netCentavos);
  }
});

test("dev-only generator refuses unknown periods", () => {
  assert.throws(() => fictionalDevSeedPayroll("unseeded" as "processing"), /complete eight-worker/);
});

test("dev-only seed uses the same source for headers and rows", () => {
  const source = readFileSync("src/db/seed.ts", "utf8");
  assert.match(source, /export const DEMO_MODE = process\.env\.NODE_ENV !== "production" && process\.env\.DEMO_MODE === "true"/);
  assert.match(source, /if \(!DEMO_MODE\) \{\s*await ensureReferenceData\(\);\s*return;/);
  assert.match(source, /if \(value > 0\) \{/);
  assert.match(source, /orderBy\(asc\(employees\.employeeNo\)\)/);
  assert.match(source, /loomPeople\.length !== DEV_DEMO_PAYROLL_WORKERS/);
  for (const name of ["processingFixture", "releasedFixture"]) {
    assert.match(source, new RegExp("grossPay: " + name + "\\.grossPay"));
    assert.match(source, new RegExp("netPay: " + name + "\\.netPay"));
    assert.match(source, new RegExp(name + "\\.entries\\[index\\]"));
  }
  // The draft has no pay lines yet. Do not show a fake computed gross/net.
  const draft = source.match(/periodLabel: "Feb 16–28, 2026"[^\n]*/)?.[0];
  assert.ok(draft);
  assert.match(draft, /status: "Draft"/);
  assert.match(draft, /grossPay: "0\.00", netPay: "0\.00"/);
  assert.doesNotMatch(source, /db\.update\(payrollRuns\)/);
});
