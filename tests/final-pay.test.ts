import test from "node:test";
import assert from "node:assert/strict";
import { computeFinalPay, finalPayDueDate, readBasicAndThirteenth } from "../src/lib/final-pay";

test("13th-month base uses basic earnings and effective-dated retro only", () => {
  const parsed = readBasicAndThirteenth([
    { code: "BASIC", label: "Basic / worked pay", amount: "11000.00" },
    { code: "RETRO-4", label: "Retro pay, prior cutoff", amount: "1000.00" },
    { code: "OT", label: "Overtime", amount: "1500.00" },
    { code: "ND", label: "Night differential", amount: "300.00" },
    { code: "13TH", label: "13th Month Pay", amount: "5000.00" },
    { code: "SSS", label: "SSS contribution", amount: "-500.00" },
    { code: "WHT", label: "Withholding tax", amount: "-700.00" },
  ]);

  assert.equal(parsed.basic, 12000);
  assert.equal(parsed.thirteenthPaid, 5000);
  assert.equal(parsed.contributions, 500);
  assert.equal(parsed.taxWithheld, 700);
});

test("final pay computes 13th month from actual annual basic earned and subtracts amounts already paid", () => {
  const result = computeFinalPay({
    releasedBasicYtd: 110000,
    historicalBasicYtd: 20000,
    unpaidBasicSalary: 10000,
    thirteenthPaidYtd: 5000,
    grossCompensationYtd: 150000,
    statutoryContributionsYtd: 12000,
    taxWithheldYtd: 9000,
    mwe: false,
    leaveMonetizationPay: 3000,
    separationPay: 0,
    retirementPay: 0,
    otherBenefits: 0,
    loanDeductions: 2000,
  });

  assert.equal(result.basicSalaryEarnedYtd, 140000);
  assert.equal(result.thirteenthEntitlement, 11666.67);
  assert.equal(result.thirteenthPaidYtd, 5000);
  assert.equal(result.thirteenthDue, 6666.67);
  assert.equal(result.grossFinalPay, 19666.67);
  assert.ok(Number.isFinite(result.taxAdjustment));
  assert.ok(result.netFinalPay >= 0);
});

test("fully-paid 13th month cannot be paid twice in final pay", () => {
  const result = computeFinalPay({
    releasedBasicYtd: 120000,
    historicalBasicYtd: 0,
    unpaidBasicSalary: 0,
    thirteenthPaidYtd: 10000,
    grossCompensationYtd: 120000,
    statutoryContributionsYtd: 10000,
    taxWithheldYtd: 0,
    mwe: true,
    leaveMonetizationPay: 0,
    separationPay: 0,
    retirementPay: 0,
    otherBenefits: 0,
    loanDeductions: 0,
  });
  assert.equal(result.thirteenthEntitlement, 10000);
  assert.equal(result.thirteenthDue, 0);
});

test("final pay due date is 30 calendar days after separation", () => {
  assert.equal(finalPayDueDate("2026-09-30"), "2026-10-30");
  assert.equal(finalPayDueDate("2026-12-15"), "2027-01-14");
});
