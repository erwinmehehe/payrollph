import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MAX_PAYROLL_PERIOD_DAYS,
  inclusivePeriodDays,
  validIsoDate,
} from "../src/lib/payroll-period-validation";

test("payroll and preview agree on valid dates, inclusive cutoffs and the 16-day cap", () => {
  assert.equal(MAX_PAYROLL_PERIOD_DAYS, 16);
  for (const invalid of ["2026-02-29", "2026-13-01", "2026-00-11", "2026-10-32", "10/15/2026", "2026-1-01", ""]) {
    assert.equal(validIsoDate(invalid), false, invalid);
  }
  for (const date of ["2024-02-29", "2026-10-01", "2026-10-15", "2026-12-31"]) {
    assert.equal(validIsoDate(date), true, date);
  }
  assert.equal(inclusivePeriodDays("2026-10-01", "2026-10-15"), 15);
  assert.equal(inclusivePeriodDays("2026-10-01", "2026-10-16"), 16);
  assert.equal(inclusivePeriodDays("2026-10-01", "2026-10-17"), 17);
  assert.equal(inclusivePeriodDays("2024-02-28", "2024-02-29"), 2);
  assert.equal(inclusivePeriodDays("2026-10-16", "2026-10-15"), 0);
});

test("read-only preview and payroll run both use the same cutoff validator", () => {
  const payroll = readFileSync("src/app/api/payroll-runs/route.ts", "utf8");
  const preview = readFileSync("src/app/api/first-payroll/preview/route.ts", "utf8");
  for (const source of [payroll, preview]) {
    assert.match(source, /from ["']@\/lib\/payroll-period-validation["']/);
    assert.match(source, /inclusivePeriodDays\(periodStart,\s*periodEnd\)/);
    assert.match(source, /MAX_PAYROLL_PERIOD_DAYS/);
  }
  assert.match(preview, /validIsoDate\(periodStart\)/);
  assert.match(preview, /validIsoDate\(periodEnd\)/);
  assert.match(preview, /validIsoDate\(payDate\)/);
  assert.match(preview, /SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY/);
});
