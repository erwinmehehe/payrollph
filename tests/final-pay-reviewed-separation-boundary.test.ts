import test from "node:test";
import assert from "node:assert/strict";
import { computeFinalPay } from "../src/lib/final-pay";
import { classifyReviewedSeparationPay } from "../src/lib/final-pay-tax-classification";

/**
 * Fictional arithmetic only: no employer rows, bank/provider calls, filings,
 * financial-release flags or claim of Philippine tax-practitioner approval.
 */
const basePay = {
  releasedBasicYtd: 600_000,
  historicalBasicYtd: 0,
  unpaidBasicSalary: 0,
  thirteenthPaidYtd: 0,
  grossCompensationYtd: 600_000,
  statutoryContributionsYtd: 0,
  taxWithheldYtd: 0,
  mwe: false,
  leaveMonetizationPay: 15_000,
  deMinimisLeaveMonetizationPay: 12_000,
  benefitPoolLeaveMonetizationPay: 3_000,
  separationPay: 200_000,
  retirementPay: 0,
  otherBenefits: 40_000,
  loanDeductions: 0,
};

test("reviewed partial separation + vacation leave split preserves payout and shares the 90k benefit pool", () => {
  const review = classifyReviewedSeparationPay({
    separationPay: 200_000,
    taxableAmount: 50_000,
    exemptionReason: "redundancy",
    evidenceReference: "FICTIONAL-CTE-REVIEW-REFERENCE",
    separationType: "authorized_cause",
  });
  assert.equal(review.taxablePay, 50_000);
  assert.equal(review.exemptPay, 150_000);
  const result = computeFinalPay({ ...basePay, taxableSeparationPay: review.taxablePay });
  assert.equal(result.thirteenthDue, 50_000);
  assert.equal(result.grossFinalPay, 305_000);
  assert.equal(result.annualization.grossCompensation, 755_000);
  assert.equal(result.annualization.deMinimis, 12_000);
  assert.equal(result.annualization.benefitPool, 93_000);
  assert.equal(result.annualization.exemptBenefitPool, 90_000);
  assert.equal(result.annualization.taxableBenefitPool, 3_000);
  assert.equal(result.annualization.taxableIncome, 653_000);
  const fullyTaxable = computeFinalPay({ ...basePay });
  assert.equal(fullyTaxable.grossFinalPay, result.grossFinalPay);
  assert.ok(fullyTaxable.annualization.taxableIncome > result.annualization.taxableIncome);
});

test("shared final-pay calculator rejects invalid explicit taxable separation allocations before annualization", () => {
  const invalid = [
    { separationPay: 200_000, taxableSeparationPay: -1 },
    { separationPay: 200_000, taxableSeparationPay: 200_000.01 },
    { separationPay: 200_000, taxableSeparationPay: 1.005 },
    { separationPay: 200_000, taxableSeparationPay: NaN },
    { separationPay: 200_000, taxableSeparationPay: Infinity },
    { separationPay: 200_000.001, taxableSeparationPay: 0 },
    { separationPay: -10, taxableSeparationPay: 0 },
  ];
  for (const values of invalid) {
    assert.throws(() => computeFinalPay({ ...basePay, ...values }),
      /Invalid reviewed final-pay separation tax split/,
      "Invalid explicit amount must never silently change annualized compensation");
  }
  const reviewedZero = computeFinalPay({ ...basePay, taxableSeparationPay: 0 });
  const reviewedFull = computeFinalPay({ ...basePay, taxableSeparationPay: 200_000 });
  assert.equal(reviewedZero.grossFinalPay, reviewedFull.grossFinalPay);
  assert.equal(reviewedFull.annualization.taxableIncome - reviewedZero.annualization.taxableIncome, 200_000);
});
