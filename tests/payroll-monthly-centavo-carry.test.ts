/**
 * #2003 fictional-only centavo allocation regression.
 * Source: SSS Circular 2024-006, business employers, page 1:
 * https://www.sss.gov.ph/wp-content/uploads/2024/12/2025-SSS-Contribution-Table-rev.pdf
 * The monthly SSS row is based on actual monthly remuneration. A 50/50 cutoff
 * collection schedule and first-up/second-remainder basic salary allocation
 * are PayrollPH software conventions, not rules prescribed by the circular.
 * This is a pure unit test, not real-engine, ledger, agency or human approval.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { splitFixedMonthlyBasic, verifiedFirstCutoffForFixedMonthlyCarry } from "../src/lib/payroll-money";
import { computeCutoffStatutoryDeduction, computeSss } from "../src/lib/payroll-rules";

type Case = {
  label: string; monthly: number; first: number; second: number;
  sssEmployee: number; sssEmployer: number; employerEc: number;
};
const cases: Case[] = [
  { label: "C02", monthly: 1500.01, first: 750.01, second: 750.00,
    sssEmployee: 250, sssEmployer: 500, employerEc: 10 },
  { label: "C03 below SSS 5,250 boundary", monthly: 5249.99, first: 2625.00, second: 2624.99,
    sssEmployee: 250, sssEmployer: 500, employerEc: 10 },
  { label: "C04 at SSS 5,250 boundary", monthly: 5250.00, first: 2625.00, second: 2625.00,
    sssEmployee: 275, sssEmployer: 550, employerEc: 10 },
  { label: "C08 below SSS 14,750/EC boundary", monthly: 14749.99, first: 7375.00, second: 7374.99,
    sssEmployee: 725, sssEmployer: 1450, employerEc: 10 },
  { label: "C09 at SSS 14,750/EC boundary", monthly: 14750.00, first: 7375.00, second: 7375.00,
    sssEmployee: 750, sssEmployer: 1500, employerEc: 30 },
  { label: "C10 odd-cent above SSS 14,750 boundary", monthly: 14750.01, first: 7375.01, second: 7375.00,
    sssEmployee: 750, sssEmployer: 1500, employerEc: 30 },
  { label: "C12 below SSS 34,750 boundary", monthly: 34749.99, first: 17375.00, second: 17374.99,
    sssEmployee: 1725, sssEmployer: 3450, employerEc: 30 },
  { label: "C13 at SSS 34,750 boundary", monthly: 34750.00, first: 17375.00, second: 17375.00,
    sssEmployee: 1750, sssEmployer: 3500, employerEc: 30 },
  { label: "C16 high salary odd-cent", monthly: 100000.01, first: 50000.01, second: 50000.00,
    sssEmployee: 1750, sssEmployer: 3500, employerEc: 30 },
];

const cents = (value: number) => Math.round(value * 100);

test("fixed full-month salary cutoffs carry the centavo without creating pay", () => {
  for (const c of cases) {
    const split = splitFixedMonthlyBasic(c.monthly);
    assert.equal(cents(split.first), cents(c.first), c.label + " first basic");
    assert.equal(cents(split.second), cents(c.second), c.label + " final basic");
    assert.equal(cents(split.first) + cents(split.second), cents(c.monthly), c.label + " whole-month basic");
    assert.equal(cents(split.monthly), cents(c.monthly), c.label + " contract authority");
  }
});

test("SSS bracket boundary and employee/employer/EC match original monthly source", () => {
  for (const c of cases) {
    const sss = computeSss(c.monthly, "2026-07-31");
    assert.equal(cents(sss.employee), cents(c.sssEmployee), c.label + " EE");
    assert.equal(cents(sss.employer), cents(c.sssEmployer), c.label + " ER");
    assert.equal(cents(sss.employerEC), cents(c.employerEc), c.label + " EC");
    const collected: Record<"employee" | "employer" | "employerEC", number> = {
      employee: sss.employee, employer: sss.employer, employerEC: sss.employerEC,
    };
    for (const [component, monthlyTarget] of Object.entries(collected)) {
      const first = computeCutoffStatutoryDeduction({
        monthlyTarget, priorCollected: 0, timing: "split", isSecondCutoff: false,
      });
      const second = computeCutoffStatutoryDeduction({
        monthlyTarget, priorCollected: first, timing: "split", isSecondCutoff: true,
      });
      assert.equal(cents(first) + cents(second), cents(monthlyTarget), c.label + " " + component);
    }
  }
});

test("a one-cent lower actual month requires an explicit second-cutoff remainder", () => {
  const c = splitFixedMonthlyBasic(5249.99);
  assert.equal(cents(c.first * 2), 525000, "legacy doubled first basic falsely reaches the next MSC bracket");
  assert.equal(cents(c.first) + cents(c.second), 524999, "the actual month stays below the bracket");
  assert.equal(computeSss(c.monthly, "2026-07-31").employee, 250, "correct actual-month EE SSS");
  assert.equal(computeSss(c.first * 2, "2026-07-15").employee, 275,
    "historical projected first-cutoff error reproduced, not approved");
});

test("invalid / fractional-cent salaries cannot be silently allocated", () => {
  for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, -1, 5249.991, 100_000_000_000_000]) {
    assert.throws(() => splitFixedMonthlyBasic(invalid));
  }
});

test("second cutoff requires one matching released first-cutoff source", () => {
  const valid = {
    monthlySalary: 5249.99,
    finalPeriodStart: "2026-07-16",
    priorEntries: 1,
    priorPeriodStart: "2026-07-01",
    priorPeriodEnd: "2026-07-15",
    priorPayBasis: "monthly",
    priorRateAmount: 5249.99,
    priorBasicAmount: 2625.00,
  };
  assert.equal(verifiedFirstCutoffForFixedMonthlyCarry(valid), true);
  const bad = [
    { priorEntries: 0 }, { priorEntries: 2 },
    { priorPeriodStart: "2026-07-02" }, { priorPeriodEnd: "2026-07-14" },
    { priorPeriodStart: "2026-06-01" }, { priorPayBasis: "hourly" },
    { priorRateAmount: 5250 }, { priorBasicAmount: 2624.99 },
    { priorRateAmount: null }, { priorBasicAmount: null },
    { finalPeriodStart: "2026-07-15" }, { finalPeriodStart: "2026-08-16" },
  ];
  for (const mutation of bad) {
    const evidence = { ...valid, ...mutation };
    assert.equal(verifiedFirstCutoffForFixedMonthlyCarry(evidence), false,
      "unverified prior evidence must not receive an approved centavo carry: " + JSON.stringify(mutation));
  }
});
