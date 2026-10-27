import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { formatRecentPayrollNetPay } from "../src/lib/recent-payroll-display";

test("recent payroll amounts retain centavos and render real zero as PHP zero", () => {
  assert.equal(formatRecentPayrollNetPay("1234.50"), "₱1,234.50");
  assert.equal(formatRecentPayrollNetPay("0.01"), "₱0.01");
  assert.equal(formatRecentPayrollNetPay("0.00"), "₱0.00");
  assert.equal(formatRecentPayrollNetPay(0), "₱0.00");
  assert.equal(formatRecentPayrollNetPay("-5.25"), "-₱5.25");
});

test("missing, malformed, sub-centavo or unsafe amounts are not shown as valid net pay", () => {
  for (const value of [
    null, undefined, "", " ", "NaN", "Infinity", "1e3", "1,000.00",
    "1.001", " 0.00", "0.00 ", true, {}, [], Number.NaN,
    Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0.001,
    "90071992547409.92",
  ]) {
    assert.equal(formatRecentPayrollNetPay(value), null, `should refuse ${String(value)}`);
  }
});

test("RecentPayrollRuns uses strict formatting and an explicit unavailable fallback", () => {
  const source = readFileSync("src/components/workspace/recent-payroll-runs.tsx", "utf8");
  assert.match(source, /formatRecentPayrollNetPay\(run\.netPay\)\s*\?\?\s*"Net unavailable"/);
  assert.doesNotMatch(source, /Number\(value\s*\|\|\s*0\)/);
});
