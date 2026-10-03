import assert from "node:assert/strict";
import test from "node:test";
import { annualize } from "../src/lib/annualization";

test("13th month and other benefits share one PHP 90,000 annual exemption pool", () => {
  const result = annualize({
    grossCompensation: 650_000,
    thirteenthMonth: 80_000,
    otherBenefits: 20_000,
    statutoryContributions: 0,
    taxWithheld: 0,
    mwe: false,
  });

  assert.equal(result.combinedOtherBenefits, 100_000);
  assert.equal(result.exemptCombinedOtherBenefits, 90_000);
  assert.equal(result.taxableCombinedOtherBenefits, 10_000);
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

  assert.equal(result.exemptCombinedOtherBenefits, 90_000);
  assert.equal(result.taxableCombinedOtherBenefits, 40_000);
  assert.equal(result.taxableIncome, 560_000);
});

test("MWE additional taxable compensation is not globally exempted", () => {
  const result = annualize({
    grossCompensation: 500_000,
    thirteenthMonth: 20_000,
    statutoryContributions: 20_000,
    taxWithheld: 0,
    mwe: true,
    mweExemptCompensation: 200_000,
  });

  assert.equal(result.taxableIncome, 260_000);
  assert.equal(result.taxDue, 1_500);
});
