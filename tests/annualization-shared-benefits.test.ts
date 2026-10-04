import assert from "node:assert/strict";
import test from "node:test";
import { annualize, isSharedBenefitPoolEarningType, sharedBenefitPoolCutoffTreatment } from "../src/lib/annualization";

test("13th month and other benefits share one PHP 90,000 annual exemption pool", () => {
  const result = annualize({
    grossCompensation: 650_000,
    thirteenthMonth: 80_000,
    otherBenefits: 20_000,
    statutoryContributions: 0,
    taxWithheld: 0,
    mwe: false,
  });

  assert.equal(result.benefitPool, 100_000);
  assert.equal(result.exemptBenefitPool, 90_000);
  assert.equal(result.taxableBenefitPool, 10_000);
  assert.equal(result.taxableIncome, 560_000);
});

test("taxable 13th-month excess remains in gross exactly once", () => {
  const result = annualize({
    grossCompensation: 650_000,
    thirteenthMonth: 130_000,
    statutoryContributions: 0,
    taxWithheld: 0,
    mwe: false,
  });

  assert.equal(result.exemptBenefitPool, 90_000);
  assert.equal(result.taxableBenefitPool, 40_000);
  assert.equal(result.taxableIncome, 560_000);
});

test("de minimis excess joins the same PHP 90,000 benefits pool", () => {
  const result = annualize({
    grossCompensation: 650_000,
    thirteenthMonth: 80_000,
    deMinimis: 24_000,
    deMinimisExcess: 20_000,
    statutoryContributions: 0,
    taxWithheld: 0,
    mwe: false,
  });

  assert.equal(result.benefitPool, 100_000);
  assert.equal(result.exemptBenefitPool, 90_000);
  assert.equal(result.taxableBenefitPool, 10_000);
  assert.equal(result.nonTaxable, 114_000);
});

test("MWE additional taxable compensation is not globally exempted", () => {
  const result = annualize({
    grossCompensation: 500_000,
    thirteenthMonth: 20_000,
    statutoryContributions: 20_000,
    taxWithheld: 0,
    mwe: true,
    mweTaxableSupplementaryCompensation: 280_000,
  });

  assert.equal(result.taxableIncome, 260_000);
  assert.equal(result.taxDue, 1_500);
});


test("current cutoff taxes only the portion above the remaining shared PHP 90,000 exemption", () => {
  const result = sharedBenefitPoolCutoffTreatment({
    priorPool: 85_000,
    currentPool: 7_000,
  });

  assert.deepEqual(result, {
    priorPool: 85_000,
    currentPool: 7_000,
    remainingExemption: 5_000,
    exemptCurrent: 5_000,
    taxableCurrent: 2_000,
    poolAfterCutoff: 92_000,
  });
});

test("13th month and qualifying bonuses join the shared pool while commissions do not", () => {
  for (const type of [
    "13th_month",
    "thirteenth_month",
    "bonus",
    "christmas_bonus",
    "midyear_bonus",
    "performance_bonus",
    "other_benefit_90k",
  ]) {
    assert.equal(isSharedBenefitPoolEarningType(type), true, type);
  }
  assert.equal(isSharedBenefitPoolEarningType("commission"), false);
  assert.equal(isSharedBenefitPoolEarningType("taxable_allowance"), false);
});
