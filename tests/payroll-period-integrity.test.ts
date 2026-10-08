import assert from "node:assert/strict";
import test from "node:test";
import {
  payrollPeriodsOverlap,
  payrollScopesOverlap,
} from "../src/lib/payroll-period-integrity";

test("payroll period overlap is inclusive at cutoff boundaries", () => {
  assert.equal(payrollPeriodsOverlap("2026-10-01", "2026-10-15", "2026-10-15", "2026-10-31"), true);
  assert.equal(payrollPeriodsOverlap("2026-10-01", "2026-10-15", "2026-10-16", "2026-10-31"), false);
  assert.equal(payrollPeriodsOverlap("2026-10-01", "2026-10-15", "2026-10-01", "2026-10-15"), true);
});

test("company-wide payroll conflicts with any org-unit payroll while distinct units remain independent", () => {
  assert.equal(payrollScopesOverlap(null, null), true);
  assert.equal(payrollScopesOverlap(null, 12), true);
  assert.equal(payrollScopesOverlap(12, null), true);
  assert.equal(payrollScopesOverlap(12, 12), true);
  assert.equal(payrollScopesOverlap(12, 13), false);
});
