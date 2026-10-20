import assert from "node:assert/strict";
import test from "node:test";
import {
  computeAnnualWithholdingTax,
  computeMonthlyWithholdingTax,
  computeSemiMonthlyWithholdingTax,
  computeSss,
  computePagIbig,
  computeCutoffStatutoryDeduction,
} from "../src/lib/payroll-rules";
import {
  SSS_RULE_PACKS,
  resolveEffectiveRulePack,
} from "../src/lib/ph-statutory-rule-packs";

test("statutory contribution and BIR helpers reject non-finite, negative and non-number inputs", () => {
  const calculators = [
    computeSss,
    computePagIbig,
    computeAnnualWithholdingTax,
    computeMonthlyWithholdingTax,
    computeSemiMonthlyWithholdingTax,
  ];
  for (const value of [Number.NaN, Infinity, -Infinity, -1, undefined, null, "100"]) {
    for (const calc of calculators) {
      assert.throws(
        () => calc(value as number),
        /nonnegative finite number/,
        "invalid statutory monetary input was accepted",
      );
    }
  }
  for (const taxable of [NaN, Infinity, -1]) {
    assert.throws(() => computeAnnualWithholdingTax(taxable, true), /nonnegative finite number/);
    assert.throws(() => computeSemiMonthlyWithholdingTax(taxable, true), /nonnegative finite number/);
    assert.throws(() => computeMonthlyWithholdingTax(taxable, true), /nonnegative finite number/);
  }
});

test("normal zero, threshold and valid MWE amounts retain their established payroll treatment", () => {
  assert.equal(computeSss(0).monthlySalaryCredit, 5000);
  assert.equal(computePagIbig(0).employee, 0);
  assert.equal(computeSemiMonthlyWithholdingTax(0), 0);
  assert.equal(computeMonthlyWithholdingTax(0, true), 0);
  assert.equal(computeAnnualWithholdingTax(300000), 7500);
  assert.equal(computeSss(35000).employee, 1750);
});

test("cutoff true-ups reject bad amounts instead of storing NaN or silently clipping negative debt", () => {
  const base = { monthlyTarget: 1000, priorCollected: 500, timing: "split" as const, isSecondCutoff: true };
  assert.equal(computeCutoffStatutoryDeduction(base), 500);
  for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    assert.throws(() => computeCutoffStatutoryDeduction({ ...base, monthlyTarget: invalid }), /nonnegative finite number/);
    assert.throws(() => computeCutoffStatutoryDeduction({ ...base, priorCollected: invalid }), /nonnegative finite number/);
  }
  assert.throws(
    () => computeCutoffStatutoryDeduction({ ...base, timing: "wrong" as "split" }),
    /timing and cutoff position/,
  );
});

test("rule resolution rejects impossible calendar dates, while preserving valid leap days", () => {
  for (const date of [
    "2026-02-29", "2026-02-30", "2026-04-31", "2026-00-01",
    "2026-13-01", "2026-01-00", "2026-01-32", "2026-1-1", "not-a-date",
  ]) {
    assert.throws(
      () => resolveEffectiveRulePack(SSS_RULE_PACKS, date, "SSS"),
      /ISO applicable date/,
      date,
    );
    assert.throws(() => computeSss(35000, date), /ISO applicable date/);
  }
  assert.equal(resolveEffectiveRulePack(SSS_RULE_PACKS, "2028-02-29", "SSS").version, "SSS-2025-CIRCULAR-2024-006");
  assert.equal(computeSemiMonthlyWithholdingTax(25000, false, "2028-02-29"), 2604.1);
  assert.throws(() => computeSemiMonthlyWithholdingTax(20000, true, "2026-02-30"), /ISO applicable date/);
});
