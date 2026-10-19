import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fictionalPublicDemoPayroll, PUBLIC_DEMO_PAYROLL_WORKERS } from "../src/lib/public-demo-payroll-fixture";

// These figures are illustrative, never authority for statutory withholding,
// official tax, real employer pay, bank submission or previously stored records.
const GOLDEN_FICTIONAL_RUNS = [
  { gross: "181300.00", net: "147400.00" },
  { gross: "182800.00", net: "148600.00" },
  { gross: "184300.00", net: "149800.00" },
];

test("each fictional new-run header matches the SUM of all six detail entries to the centavo", () => {
  for (const [period, expected] of GOLDEN_FICTIONAL_RUNS.entries()) {
    const fixture = fictionalPublicDemoPayroll(period);
    assert.equal(fixture.entries.length, PUBLIC_DEMO_PAYROLL_WORKERS);
    for (const row of fixture.entries) {
      assert.ok(Number.isSafeInteger(row.gross) && row.gross >= 0);
      assert.ok(Number.isSafeInteger(row.deductions) && row.deductions >= 0);
      assert.ok(Number.isSafeInteger(row.net) && row.net >= 0);
      assert.ok(row.deductions <= row.gross);
      assert.equal(row.net, row.gross - row.deductions);
    }
    assert.equal(fixture.grossPay, expected.gross);
    assert.equal(fixture.netPay, expected.net);
    const grossCentavos = fixture.entries.reduce((sum, row) => sum + Math.round(row.gross * 100), 0);
    const netCentavos = fixture.entries.reduce((sum, row) => sum + Math.round(row.net * 100), 0);
    const deductionsCentavos = fixture.entries.reduce((sum, row) => sum + Math.round(row.deductions * 100), 0);
    assert.equal(grossCentavos, Number(fixture.grossPay) * 100);
    assert.equal(netCentavos, Number(fixture.netPay) * 100);
    assert.equal(grossCentavos - deductionsCentavos, netCentavos);
  }
});

test("fictional payroll generator rejects extra historical or malformed period indexes", () => {
  for (const invalid of [-1, 3, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => fictionalPublicDemoPayroll(invalid), /three fixed fictional/);
  }
});

test("public demo source derives newly created headers and detail rows from one fixture", () => {
  const source = readFileSync("src/db/public-demo.ts", "utf8");
  assert.match(source, /const demoPayroll = \[fictionalPublicDemoPayroll\(0\), fictionalPublicDemoPayroll\(1\), fictionalPublicDemoPayroll\(2\)\]/);
  assert.match(source, /grossPay: demoPayroll\[0\]\.grossPay/);
  assert.match(source, /netPay: demoPayroll\[2\]\.netPay/);
  assert.match(source, /const fixture = demoPayroll\[runIndex\]/);
  assert.match(source, /activeStaff\.length !== fixture\.entries\.length/);
  assert.match(source, /const \{ gross, deductions, net \} = fixture\.entries\[index\]/);
});

test("never silently rewrite stored demo run headers or release historical payroll", () => {
  const source = readFileSync("src/db/public-demo.ts", "utf8");
  assert.match(source, /if \(existing\) return existing/);
  assert.doesNotMatch(source, /tx\.update\(payrollRuns\)/);
  assert.doesNotMatch(source, /\.delete\(payrollRuns\)/);
});
