import assert from "node:assert/strict";
import test from "node:test";
import { computeFinalPayDraft, summarizePayrollTaxComponents } from "../src/lib/final-pay";

test("final pay uses actual released BASIC earnings for prorated 13th month", () => {
  const summary = summarizePayrollTaxComponents([
    {
      grossPay: "15500.00",
      lineItems: [
        { code: "BASIC", label: "Basic / worked pay", amount: "12000.00" },
        { code: "OT", label: "Overtime", amount: "3500.00" },
        { code: "SSS", label: "SSS contribution", amount: "-600.00" },
        { code: "PHIC", label: "PhilHealth contribution", amount: "-300.00" },
        { code: "HDMF", label: "Pag-IBIG contribution", amount: "-100.00" },
        { code: "WHT", label: "Withholding tax", amount: "-800.00" },
      ],
    },
    {
      grossPay: "13000.00",
      lineItems: [
        { code: "BASIC", label: "Basic / worked pay", amount: "10000.00" },
        { code: "ND", label: "Night differential", amount: "3000.00" },
        { code: "SSS", label: "SSS contribution", amount: "-600.00" },
        { code: "PHIC", label: "PhilHealth contribution", amount: "-300.00" },
        { code: "HDMF", label: "Pag-IBIG contribution", amount: "-100.00" },
        { code: "WHT", label: "Withholding tax", amount: "-700.00" },
      ],
    },
  ]);

  assert.equal(summary.basicCompensation, 22000);
  assert.equal(summary.taxWithheld, 1500);
  assert.equal(summary.statutoryContributions, 2000);

  const result = computeFinalPayDraft({
    entries: [
      {
        grossPay: "15500.00",
        lineItems: [
          { code: "BASIC", label: "Basic / worked pay", amount: "12000.00" },
          { code: "OT", label: "Overtime", amount: "3500.00" },
          { code: "SSS", label: "SSS contribution", amount: "-600.00" },
          { code: "PHIC", label: "PhilHealth contribution", amount: "-300.00" },
          { code: "HDMF", label: "Pag-IBIG contribution", amount: "-100.00" },
          { code: "WHT", label: "Withholding tax", amount: "-800.00" },
        ],
      },
      {
        grossPay: "13000.00",
        lineItems: [
          { code: "BASIC", label: "Basic / worked pay", amount: "10000.00" },
          { code: "ND", label: "Night differential", amount: "3000.00" },
          { code: "SSS", label: "SSS contribution", amount: "-600.00" },
          { code: "PHIC", label: "PhilHealth contribution", amount: "-300.00" },
          { code: "HDMF", label: "Pag-IBIG contribution", amount: "-100.00" },
          { code: "WHT", label: "Withholding tax", amount: "-700.00" },
        ],
      },
    ],
    monthlyBasic: 30000,
    annualPayDivisor: 365,
    unusedLeaveCredits: 0,
    loanDeductions: 0,
    mwe: false,
  });

  assert.equal(result.basicEarnedYtd, 22000);
  assert.equal(result.prorated13thAccrued, 1833.33);
  assert.equal(result.prorated13thDue, 1833.33);
});

test("final pay annualizes tax and turns over-withholding into a refund", () => {
  const result = computeFinalPayDraft({
    entries: [
      {
        grossPay: "300000.00",
        lineItems: [
          { code: "BASIC", label: "Basic / worked pay", amount: "300000.00" },
          { code: "SSS", label: "SSS contribution", amount: "-10000.00" },
          { code: "PHIC", label: "PhilHealth contribution", amount: "-5000.00" },
          { code: "HDMF", label: "Pag-IBIG contribution", amount: "-2000.00" },
          { code: "WHT", label: "Withholding tax", amount: "-20000.00" },
        ],
      },
    ],
    monthlyBasic: 30000,
    annualPayDivisor: 365,
    unusedLeaveCredits: 5,
    loanDeductions: 2000,
    mwe: false,
  });

  assert.equal(result.prorated13thAccrued, 25000);
  assert.equal(result.leaveMonetizationPay, 4931.51);
  assert.equal(result.leaveExemptAmount, 4931.51);
  assert.equal(result.tax.outcome, "refund");
  assert.ok(result.taxCashEffect > 0);
  assert.equal(result.netFinalPay, Number((result.prorated13thDue + result.leaveMonetizationPay + result.taxCashEffect - 2000).toFixed(2)));
});

test("leave conversion beyond ten days moves the excess into the 90k benefits pool", () => {
  const result = computeFinalPayDraft({
    entries: [],
    monthlyBasic: 36500,
    annualPayDivisor: 365,
    unusedLeaveCredits: 12,
    loanDeductions: 0,
    mwe: false,
  });

  assert.equal(result.dailyRate, 1200);
  assert.equal(result.leaveMonetizationPay, 14400);
  assert.equal(result.leaveExemptAmount, 12000);
  assert.equal(result.leaveOtherBenefitsAmount, 2400);
});

test("previous-employer taxable compensation and withholding participate in termination annualization", () => {
  const withoutPrevious = computeFinalPayDraft({
    entries: [{ grossPay: "200000.00", lineItems: [{ code: "BASIC", label: "Basic / worked pay", amount: "200000.00" }] }],
    monthlyBasic: 30000,
    annualPayDivisor: 365,
    unusedLeaveCredits: 0,
    loanDeductions: 0,
    mwe: false,
  });
  const withPrevious = computeFinalPayDraft({
    entries: [{ grossPay: "200000.00", lineItems: [{ code: "BASIC", label: "Basic / worked pay", amount: "200000.00" }] }],
    monthlyBasic: 30000,
    annualPayDivisor: 365,
    unusedLeaveCredits: 0,
    loanDeductions: 0,
    mwe: false,
    previousEmployerTaxableCompensation: 250000,
    previousEmployerTaxWithheld: 10000,
  });

  assert.ok(withPrevious.tax.taxableIncome > withoutPrevious.tax.taxableIncome);
  assert.equal(withPrevious.previousEmployerTaxableCompensation, 250000);
  assert.equal(withPrevious.previousEmployerTaxWithheld, 10000);
});


test("reviewed additional final-pay amounts are included without inventing an entitlement", () => {
  const result = computeFinalPayDraft({
    entries: [],
    monthlyBasic: 30000,
    annualPayDivisor: 365,
    unusedLeaveCredits: 0,
    loanDeductions: 0,
    mwe: false,
    additionalTaxablePay: 5000,
    additionalNonTaxablePay: 3000,
  });

  assert.equal(result.additionalTaxablePay, 5000);
  assert.equal(result.additionalNonTaxablePay, 3000);
  assert.equal(result.grossFinalPayBeforeTaxAndLoans, 8000);
  assert.equal(result.tax.grossCompensation, 8000);
  assert.equal(result.tax.otherNonTaxable, 3000);
});
