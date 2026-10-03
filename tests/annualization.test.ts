import assert from "node:assert/strict";
import test from "node:test";
import {
  annualize,
  renderForm2316,
  THIRTEENTH_MONTH_EXEMPTION_CAP,
} from "../src/lib/annualization";
import { BACKOFF_SCHEDULE_MS, nextBackoffMs } from "../src/lib/webhook-backoff";

test("13th month pay is exempt up to the 90,000 cap", () => {
  const under = annualize({ grossCompensation: 600_000, thirteenthMonth: 50_000, statutoryContributions: 0, taxWithheld: 0, mwe: false });
  assert.equal(under.exemptThirteenthMonth, 50_000);
  assert.equal(under.taxableThirteenthMonth, 0);

  const over = annualize({ grossCompensation: 600_000, thirteenthMonth: 130_000, statutoryContributions: 0, taxWithheld: 0, mwe: false });
  assert.equal(over.exemptThirteenthMonth, THIRTEENTH_MONTH_EXEMPTION_CAP);
  assert.equal(over.taxableThirteenthMonth, 40_000);
});

test("annualization computes taxable income net of contributions and exemptions", () => {
  const result = annualize({
    grossCompensation: 600_000,
    thirteenthMonth: 50_000,
    statutoryContributions: 25_000,
    taxWithheld: 0,
    mwe: false,
  });
  // 600,000 + 0 taxable 13th - (50,000 exempt + 25,000 contributions) = 525,000
  assert.equal(result.taxableIncome, 525_000);
  // TRAIN: 22,500 + 20% over 400,000 => 22,500 + 25,000 = 47,500
  assert.equal(result.taxDue, 47_500);
});

test("over-withholding produces a December refund", () => {
  const result = annualize({
    grossCompensation: 600_000,
    thirteenthMonth: 50_000,
    statutoryContributions: 25_000,
    taxWithheld: 60_000,
    mwe: false,
  });
  assert.equal(result.taxDue, 47_500);
  assert.equal(result.adjustment, -12_500);
  assert.equal(result.outcome, "refund");
});

test("under-withholding produces a December collection", () => {
  const result = annualize({
    grossCompensation: 600_000,
    thirteenthMonth: 50_000,
    statutoryContributions: 25_000,
    taxWithheld: 30_000,
    mwe: false,
  });
  assert.equal(result.adjustment, 17_500);
  assert.equal(result.outcome, "collect");
});

test("exact withholding balances to zero", () => {
  const result = annualize({
    grossCompensation: 600_000,
    thirteenthMonth: 50_000,
    statutoryContributions: 25_000,
    taxWithheld: 47_500,
    mwe: false,
  });
  assert.equal(result.adjustment, 0);
  assert.equal(result.outcome, "balanced");
});

test("MWE statutory wages and enumerated premium pay stay exempt", () => {
  const result = annualize({
    grossCompensation: 220_000,
    thirteenthMonth: 18_000,
    statutoryContributions: 9_000,
    taxWithheld: 1_200,
    mwe: true,
  });
  assert.equal(result.taxableIncome, 0);
  assert.equal(result.taxDue, 0);
  assert.equal(result.adjustment, -1_200);
  assert.equal(result.outcome, "refund");
});

test("MWE taxable supplementary compensation is not zeroed by MWE status", () => {
  const result = annualize({
    grossCompensation: 520_000,
    thirteenthMonth: 18_000,
    statutoryContributions: 12_000,
    taxWithheld: 0,
    mwe: true,
    mweTaxableSupplementaryCompensation: 300_000,
  });
  assert.equal(result.taxableIncome, 288_000);
  assert.equal(result.taxDue, 5_700);
});

test("income below the 250k threshold owes no tax", () => {
  const result = annualize({ grossCompensation: 240_000, thirteenthMonth: 20_000, statutoryContributions: 12_000, taxWithheld: 0, mwe: false });
  assert.equal(result.taxDue, 0);
  assert.equal(result.outcome, "balanced");
});

test("form 2316 draft states its own limits and shows the adjustment", () => {
  const result = annualize({ grossCompensation: 600_000, thirteenthMonth: 50_000, statutoryContributions: 25_000, taxWithheld: 60_000, mwe: false });
  const doc = renderForm2316({
    taxYear: 2026,
    employerName: "Loom & Local Philippines Inc.",
    employeeName: "Mariel Santos",
    employeeNo: "LL-101",
    result,
  });
  assert.ok(doc.includes("DRAFT - NOT A CERTIFIED SUBMISSION"));
  assert.ok(doc.includes("REFUND TO EMPLOYEE"));
  assert.ok(doc.includes("12,500.00"));
  assert.ok(doc.includes("Rule version: PH-2026.03"));
});

test("webhook retry backoff escalates then caps", () => {
  assert.equal(nextBackoffMs(1), 60_000);
  assert.equal(nextBackoffMs(2), 300_000);
  assert.equal(nextBackoffMs(3), 1_500_000);
  assert.equal(nextBackoffMs(4), 7_500_000);
  // Beyond the schedule length it stays at the final interval.
  assert.equal(nextBackoffMs(9), BACKOFF_SCHEDULE_MS[BACKOFF_SCHEDULE_MS.length - 1]);
});


test("taxable 13th-month excess is not double-counted when gross already includes the benefit", () => {
  const result = annualize({
    // 500,000 regular compensation + 120,000 13th month
    grossCompensation: 620_000,
    thirteenthMonth: 120_000,
    statutoryContributions: 20_000,
    taxWithheld: 0,
    mwe: false,
  });
  assert.equal(result.exemptBenefitPool, 90_000);
  assert.equal(result.taxableBenefitPool, 30_000);
  assert.equal(result.taxableIncome, 510_000);
});

test("excess de minimis uses the same 90,000 other-benefits pool before becoming taxable", () => {
  const fullyCovered = annualize({
    // regular 500k + 70k 13th + 15k de-minimis excess
    grossCompensation: 585_000,
    thirteenthMonth: 70_000,
    deMinimisExcess: 15_000,
    statutoryContributions: 0,
    taxWithheld: 0,
    mwe: false,
  });
  assert.equal(fullyCovered.benefitPool, 85_000);
  assert.equal(fullyCovered.taxableBenefitPool, 0);
  assert.equal(fullyCovered.taxableIncome, 500_000);

  const partlyTaxable = annualize({
    // regular 500k + 85k 13th + 20k de-minimis excess
    grossCompensation: 605_000,
    thirteenthMonth: 85_000,
    deMinimisExcess: 20_000,
    statutoryContributions: 0,
    taxWithheld: 0,
    mwe: false,
  });
  assert.equal(partlyTaxable.benefitPool, 105_000);
  assert.equal(partlyTaxable.taxableBenefitPool, 15_000);
  assert.equal(partlyTaxable.taxableIncome, 515_000);
});
