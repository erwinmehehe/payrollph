import test from "node:test";
import assert from "node:assert/strict";
import { calculateLeaveMonetizationPay, computeFinalPay, finalPayDueDate, readBasicAndThirteenth } from "../src/lib/final-pay";
import { readFileSync } from "node:fs";

test("13th-month base uses basic earnings and effective-dated retro only", () => {
  const parsed = readBasicAndThirteenth([
    { code: "BASIC", label: "Basic / worked pay", amount: "11000.00" },
    { code: "RETRO-4", label: "Retro pay, prior cutoff", amount: "1000.00" },
    { code: "LEAVE-8", label: "Unpaid leave, Vacation", amount: "-500.00" },
    { code: "LATE", label: "Tardiness", amount: "-100.00" },
    { code: "UT", label: "Undertime", amount: "-50.00" },
    { code: "OT", label: "Overtime", amount: "1500.00" },
    { code: "ND", label: "Night differential", amount: "300.00" },
    { code: "13TH", label: "13th Month Pay", amount: "5000.00" },
    { code: "SSS", label: "SSS contribution", amount: "-500.00" },
    { code: "WHT", label: "Withholding tax", amount: "-700.00" },
  ]);

  assert.equal(parsed.basic, 11350);
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


test("final-pay line parser preserves de minimis exempt and shared-pool excess amounts", () => {
  const parsed = readBasicAndThirteenth([
    {
      code: "DM-1",
      label: "De minimis, rice subsidy",
      amount: "3000.00",
      notes: ["month ceiling ₱2500.00", "other-benefits pool excess this period ₱500.00"],
    },
    {
      code: "DM-2",
      label: "De minimis, laundry allowance",
      amount: "400.00",
      notes: ["month ceiling ₱400.00", "other-benefits pool excess this period ₱0.00"],
    },
  ]);

  assert.equal(parsed.deMinimisPaid, 3400);
  assert.equal(parsed.deMinimisExcess, 500);
});

test("MWE final pay keeps taxable supplementary compensation taxable", () => {
  const result = computeFinalPay({
    releasedBasicYtd: 120000,
    historicalBasicYtd: 0,
    unpaidBasicSalary: 0,
    thirteenthPaidYtd: 10000,
    grossCompensationYtd: 150000,
    deMinimisYtd: 0,
    deMinimisExcessYtd: 0,
    statutoryContributionsYtd: 10000,
    taxWithheldYtd: 0,
    mwe: true,
    mweTaxableSupplementaryCompensationYtd: 260000,
    leaveMonetizationPay: 30000,
    taxableLeaveMonetizationPay: 30000,
    separationPay: 0,
    retirementPay: 0,
    otherBenefits: 0,
    loanDeductions: 0,
  });

  assert.ok(result.annualization.taxableIncome > 250000);
  assert.ok(result.annualization.taxDue > 0);
});


test("SIL leave encashment computes actual gross pesos using the resolved daily rate", () => {
  // Real separation source calculates leave credits * employee daily rate.
  const monthlyRate = 26_400;
  const dailyRate = monthlyRate / 22; // employee's configured workday divisor
  assert.equal(dailyRate, 1200);
  assert.equal(calculateLeaveMonetizationPay(3.5, dailyRate), 4200);
  assert.equal(calculateLeaveMonetizationPay(0, dailyRate), 0);
  assert.equal(calculateLeaveMonetizationPay(2.5, 1452.75), 3631.88);
  assert.throws(() => calculateLeaveMonetizationPay(-1, dailyRate), /non-negative/);
  assert.throws(() => calculateLeaveMonetizationPay(1, NaN), /finite/);
  const route = readFileSync("src/app/api/separation/route.ts", "utf8");
  assert.match(route, /calculateLeaveMonetizationPay\(unusedLeaveCredits, sources\.resolvedPayProfile\.dailyRate\)/);
});

test("final-pay annual tax handoff pins exact refundable withholding", () => {
  const result = computeFinalPay({
    releasedBasicYtd: 240000, historicalBasicYtd: 0, unpaidBasicSalary: 0,
    thirteenthPaidYtd: 20000, grossCompensationYtd: 240000,
    statutoryContributionsYtd: 0, taxWithheldYtd: 1000,
    mwe: false, leaveMonetizationPay: 0, separationPay: 0,
    retirementPay: 0, otherBenefits: 0, loanDeductions: 0,
  });
  // Below the ₱250k annual taxable threshold: the ₱1,000 already withheld is refunded.
  assert.equal(result.annualization.taxableIncome, 240000);
  assert.equal(result.annualization.taxDue, 0);
  assert.equal(result.taxAdjustment, 1000);
  assert.equal(result.netFinalPay, 1000);
});

test("final-pay annual tax handoff pins amount owed, not just finite tax", () => {
  const result = computeFinalPay({
    releasedBasicYtd: 300000, historicalBasicYtd: 0, unpaidBasicSalary: 0,
    thirteenthPaidYtd: 25000, grossCompensationYtd: 300000,
    statutoryContributionsYtd: 0, taxWithheldYtd: 0,
    mwe: false, leaveMonetizationPay: 0, separationPay: 0,
    retirementPay: 0, otherBenefits: 0, loanDeductions: 0,
  });
  // TRAIN 2023+ annual bracket: 15% of taxable excess over ₱250,000.
  assert.equal(result.annualization.taxableIncome, 300000);
  assert.equal(result.annualization.taxDue, 7500);
  assert.equal(result.taxAdjustment, -7500);
  assert.equal(result.netFinalPay, 0);
});
