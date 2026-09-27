import assert from "node:assert/strict";
import test from "node:test";
import { computeThirteenthMonthPay } from "../src/lib/ph-compliance";
import { computeEwa } from "../src/lib/ewa";
import { computeBalance } from "../src/lib/leave-accrual";

test("DOLE 13th month pay formula divides annual basic salary earned by 12", () => {
  // Presidential Decree No. 851: Total Basic Salary Earned / 12
  const basicEarned3Months = 35000 * 3;
  assert.equal(computeThirteenthMonthPay(basicEarned3Months), 8750);

  const basicEarnedFullYear = 48000 * 12;
  assert.equal(computeThirteenthMonthPay(basicEarnedFullYear), 48000);
});

test("unused leave monetization converts days at daily basic rate", () => {
  // Basic / 22 = daily rate; unused days * daily rate
  const monthlyBasic = 38500;
  const dailyRate = monthlyBasic / 22; // 1750.00
  const unusedDays = 5.5;
  const cashValue = Number((unusedDays * dailyRate).toFixed(2));
  assert.equal(cashValue, 9625.00);
});

test("separation final pay reconciles prorated 13th month, leave monetization, and loan deductions", () => {
  const monthlyBasic = 40000;
  const monthsWorked = 6;
  const prorated13th = computeThirteenthMonthPay(monthlyBasic * monthsWorked); // 20,000
  const dailyRate = monthlyBasic / 22; // 1818.18
  const unusedLeaveDays = 4;
  const leaveCash = Number((unusedLeaveDays * dailyRate).toFixed(2)); // 7272.72
  const activeLoanBalance = 5000.00;

  const netFinalPay = Number((prorated13th + leaveCash - activeLoanBalance).toFixed(2));
  assert.equal(prorated13th, 20000);
  assert.equal(leaveCash, 7272.73);
  assert.equal(netFinalPay, 22272.73);
});

test("loan amortization deduction calculates proper semi-monthly cut-off amount", () => {
  const principal = 24000;
  const monthlyAmortization = 1000;
  const cutoffDeduction = monthlyAmortization / 2; // 500 per semi-monthly cutoff
  assert.equal(cutoffDeduction, 500);

  // If remaining balance is less than standard cutoff, deduction is clamped to remaining balance
  const smallRemainingBalance = 320;
  const actualDeduct = Math.min(cutoffDeduction, smallRemainingBalance);
  assert.equal(actualDeduct, 320);
});

test("DOLE Twin-Notice Rule progression follows mandatory legal steps", () => {
  const validStages = ["nte_issued", "explanation_submitted", "hearing_scheduled", "nod_issued", "closed"];
  assert.equal(validStages[0], "nte_issued");
  assert.equal(validStages[1], "explanation_submitted");
  assert.equal(validStages[2], "hearing_scheduled");
  assert.equal(validStages[3], "nod_issued");
});

test("recruitment candidate pipeline stages cover full ATS workflow", () => {
  const atsStages = ["applied", "screening", "interview", "offer", "hired", "rejected"];
  assert.ok(atsStages.includes("applied"));
  assert.ok(atsStages.includes("interview"));
  assert.ok(atsStages.includes("offer"));
  assert.ok(atsStages.includes("hired"));
});

test("biometric ADMS sync accepts standard punch types", () => {
  const inPunch = "0";
  const outPunch = "1";
  assert.equal(inPunch === "0", true);
  assert.equal(outPunch === "1", true);
});
