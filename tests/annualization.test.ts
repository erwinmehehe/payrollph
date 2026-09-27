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
  // 600,000 all-in gross - (50,000 exempt 13th + 25,000 contributions) = 525,000
  assert.equal(result.taxableIncome, 525_000);
  // TRAIN: 22,500 + 20% over 400,000 => 22,500 + 25,000 = 47,500
  assert.equal(result.taxDue, 47_500);
});

test("excess de minimis shares the 90k pool with 13th-month pay", () => {
  const result = annualize({ grossCompensation: 500_000, thirteenthMonth: 70_000, otherBenefits90kPool: 30_000, deMinimis: 25_000, statutoryContributions: 15_000, taxWithheld: 0, mwe: false });
  assert.equal(result.exemptOtherBenefits90k, 20_000);
  assert.equal(result.taxableOtherBenefits90k, 10_000);
  assert.equal(result.taxableIncome, 370_000);
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

test("MWE statutory components are exempt and erroneous withholding is refunded", () => {
  const result = annualize({
    grossCompensation: 238_000,
    thirteenthMonth: 18_000,
    statutoryContributions: 9_000,
    taxWithheld: 1_200,
    mwe: true,
    mweExemptCompensation: 220_000,
  });
  assert.equal(result.taxableIncome, 0);
  assert.equal(result.taxDue, 0);
  assert.equal(result.adjustment, -1_200);
  assert.equal(result.outcome, "refund");
});

test("MWE supplementary taxable compensation remains taxable", () => {
  const result = annualize({ grossCompensation: 500_000, thirteenthMonth: 20_000, statutoryContributions: 10_000, taxWithheld: 0, mwe: true, mweExemptCompensation: 200_000 });
  assert.equal(result.taxableIncome, 270_000);
  assert.equal(result.taxDue, 3_000);
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
  assert.ok(doc.includes("Rule version: PH-2026.09"));
});

test("webhook retry backoff escalates then caps", () => {
  assert.equal(nextBackoffMs(1), 60_000);
  assert.equal(nextBackoffMs(2), 300_000);
  assert.equal(nextBackoffMs(3), 1_500_000);
  assert.equal(nextBackoffMs(4), 7_500_000);
  // Beyond the schedule length it stays at the final interval.
  assert.equal(nextBackoffMs(9), BACKOFF_SCHEDULE_MS[BACKOFF_SCHEDULE_MS.length - 1]);
});
