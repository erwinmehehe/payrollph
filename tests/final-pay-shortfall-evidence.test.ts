import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { computeFinalPay, unresolvedFinalPayMandatoryShortfall } from "../src/lib/final-pay";
import { finalPayReviewCsv, finalPayReviewShortfall } from "../src/lib/final-pay-review-evidence";
import { storedMoneyCentavos } from "../src/lib/stored-money-centavos";

test("uncollected annual withholding is persisted as a liability, not erased by zero net pay", () => {
  const result = computeFinalPay({
    releasedBasicYtd: 300000, historicalBasicYtd: 0, unpaidBasicSalary: 0,
    thirteenthPaidYtd: 25000, grossCompensationYtd: 300000,
    statutoryContributionsYtd: 0, taxWithheldYtd: 0, mwe: false,
    leaveMonetizationPay: 0, separationPay: 0, retirementPay: 0,
    otherBenefits: 0, loanDeductions: 0,
  });
  assert.equal(result.taxAdjustment, -7500);
  assert.equal(result.netFinalPay, 0);
  assert.equal(result.unpaidTaxWithholding, 7500);
  assert.equal(result.unpaidMandatoryDeductions, 7500);
  assert.equal(result.appliedTaxCollection, 0);
});

test("uncollected statutory deduction remains visible separately from deferred loan", () => {
  const result = computeFinalPay({
    releasedBasicYtd: 0, historicalBasicYtd: 0, unpaidBasicSalary: 0,
    thirteenthPaidYtd: 0, grossCompensationYtd: 0,
    statutoryContributionsYtd: 0, taxWithheldYtd: 0, mwe: true,
    leaveMonetizationPay: 0, separationPay: 0, retirementPay: 0,
    otherBenefits: 0, finalStatutoryDeductions: 123.45,
    loanDeductions: 500,
  });
  assert.equal(result.netFinalPay, 0);
  assert.equal(result.unpaidTaxWithholding, 0);
  assert.equal(result.unpaidStatutoryDeductions, 123.45);
  assert.equal(result.unpaidMandatoryDeductions, 123.45);
  assert.equal(result.deferredLoanBalance, 500);
});

test("approval/release preflight fails closed for legacy rows without snapshot fields", () => {
  assert.equal(unresolvedFinalPayMandatoryShortfall({ grossFinalPay: "0", taxAdjustment: "-7500", finalStatutoryDeductions: "50" }), 7550);
  assert.equal(unresolvedFinalPayMandatoryShortfall({ grossFinalPay: "900", taxAdjustment: "-200", finalStatutoryDeductions: "300" }), 0);
  assert.equal(unresolvedFinalPayMandatoryShortfall({ grossFinalPay: "bad", taxAdjustment: "0", finalStatutoryDeductions: "0" }), null);
  const route = readFileSync("src/app/api/separation/route.ts", "utf8");
  assert.match(route, /unpaidMandatoryDeductions: result\.unpaidMandatoryDeductions/);
  assert.ok((route.match(/unresolvedFinalPayMandatoryShortfall\(/g) ?? []).length >= 3, "outer and transaction-locked gates required");
  assert.match(route, /FINAL_PAY_MANDATORY_SHORTFALL_REVIEW_REQUIRED/);
});

test("review CSV preserves liabilities, warns about approvals and neutralizes spreadsheet formulas", () => {
  const record = {
    id: 7,
    employeeNo: "EMP-7",
    employeeName: "=HYPERLINK(\"https://example.invalid\",\"click\")",
    grossFinalPay: "0.00",
    taxAdjustment: "-7500.00",
    finalStatutoryDeductions: "50.00",
    loanDeductions: "0.00",
    netFinalPay: "0.00",
    computationSnapshot: {
      unpaidTaxWithholding: 7500,
      unpaidStatutoryDeductions: 50,
      unpaidMandatoryDeductions: 7550,
      shortfallAllocationPolicy: "tax-first-provisional-review-required",
    },
  };
  const computed = finalPayReviewShortfall(record);
  assert.equal(computed.total, 7550);
  assert.equal(computed.tax, 7500);
  assert.equal(computed.statutory, 50);
  assert.equal(computed.reconciliationRequired, true);
  const csv = finalPayReviewCsv(record);
  assert.match(csv, /7550\.00/);
  assert.match(csv, /7500\.00/);
  assert.match(csv, /'\=HYPERLINK/);
  assert.match(csv, /BLOCKED - FINANCE\/PAYROLL RECONCILIATION REQUIRED/);
  assert.match(csv, /Review worksheet only/);
  assert.equal(finalPayReviewShortfall({ ...record, computationSnapshot: {} }).splitRecorded, false);
});

test("release preflight does not coerce missing, blank or malformed financial evidence to PHP zero", () => {
  const good = { grossFinalPay: "900.00", taxAdjustment: "-200.00", finalStatutoryDeductions: "300.00" };
  assert.equal(unresolvedFinalPayMandatoryShortfall(good), 0);
  for (const malformed of [null, undefined, "", " ", true, false, "NaN", "1e2", "0.001", Number.NaN, Number.POSITIVE_INFINITY, 0.001, {}, 1e20]) {
    assert.equal(storedMoneyCentavos(malformed), null, String(malformed));
    assert.equal(unresolvedFinalPayMandatoryShortfall({ ...good, grossFinalPay: malformed }), null);
    assert.equal(unresolvedFinalPayMandatoryShortfall({ ...good, taxAdjustment: malformed }), null);
    assert.equal(unresolvedFinalPayMandatoryShortfall({ ...good, finalStatutoryDeductions: malformed }), null);
  }
  assert.equal(storedMoneyCentavos("123.45"), 12345);
  assert.equal(storedMoneyCentavos(-0.01), -1);
  assert.equal(unresolvedFinalPayMandatoryShortfall({
    grossFinalPay: "0.01", taxAdjustment: "-0.02", finalStatutoryDeductions: "0.01",
  }), 0.02);
});

test("review worksheet never labels malformed finance fields as paid or settled", () => {
  const record = {
    id: 12, employeeNo: "QA-12", employeeName: "Synthetic Worker",
    grossFinalPay: "", taxAdjustment: "0.00", finalStatutoryDeductions: "0.00",
    loanDeductions: "0.00", netFinalPay: "0.00",
  };
  const review = finalPayReviewShortfall(record);
  assert.equal(review.total, null);
  assert.equal(review.reconciliationRequired, true);
  assert.equal(review.splitRecorded, false);
  const csv = finalPayReviewCsv(record);
  assert.ok(csv.includes('"Gross final pay (PHP)","UNVERIFIABLE"'));
  assert.ok(csv.includes("BLOCKED - FINANCE/PAYROLL RECONCILIATION REQUIRED"));
  assert.ok(!csv.includes('"Gross final pay (PHP)","0.00"'));
});
