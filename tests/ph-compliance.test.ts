import assert from "node:assert/strict";
import test from "node:test";
import {
  computeMonthlyWithholdingTax,
  computePagIbig,
  computeSemiMonthlyWithholdingTax,
  computeSss,
} from "../src/lib/payroll-rules";
import {
  computeThirteenthMonthPay,
  DE_MINIMIS_2026,
  deMinimisTreatment,
  isValidPayInterval,
  statutoryDueDate,
  thirteenthMonthDeadline,
} from "../src/lib/ph-compliance";

test("Pag-IBIG 2026 uses a PHP 10,000 fund-salary cap", () => {
  assert.deepEqual(computePagIbig(1_500), {
    fundSalary: 1_500,
    employeeRate: 0.01,
    employerRate: 0.02,
    employee: 15,
    employer: 30,
    total: 45,
  });
  assert.equal(computePagIbig(5_000).employee, 100);
  assert.equal(computePagIbig(5_000).employer, 100);
  assert.equal(computePagIbig(10_000).employee, 200);
  assert.equal(computePagIbig(10_000).employer, 200);
  assert.equal(computePagIbig(80_000).fundSalary, 10_000);
  assert.equal(computePagIbig(80_000).total, 400);
});

test("SSS includes the employer-only EC premium", () => {
  const low = computeSss(10_000);
  assert.equal(low.employee, 500);
  assert.equal(low.employer, 1_000);
  assert.equal(low.employerEC, 10);
  assert.equal(low.employerTotal, 1_010);
  assert.equal(low.total, 1_510);

  const high = computeSss(35_000);
  assert.equal(high.employee, 1_750);
  assert.equal(high.employer, 3_500);
  assert.equal(high.employerEC, 30);
  assert.equal(high.employerTotal, 3_530);
  assert.equal(high.total, 5_280);
});

test("2026 monthly BIR withholding brackets match the published table", () => {
  assert.equal(computeMonthlyWithholdingTax(20_833), 0);
  assert.equal(computeMonthlyWithholdingTax(30_000), 1_375.05);
  assert.equal(computeMonthlyWithholdingTax(50_000), 5_208.4);
  assert.equal(computeMonthlyWithholdingTax(100_000), 16_875.05);
  assert.equal(computeMonthlyWithholdingTax(200_000), 43_541.7);
  assert.equal(computeMonthlyWithholdingTax(700_000), 195_208.35);
  assert.equal(computeMonthlyWithholdingTax(1_000_000, true), 0);
});

test("semi-monthly withholding is half the monthly table on twice-period taxable income", () => {
  assert.equal(computeSemiMonthlyWithholdingTax(10_416.5), 0);
  assert.equal(computeSemiMonthlyWithholdingTax(15_000), 687.53);
  assert.equal(computeSemiMonthlyWithholdingTax(25_000), 2_604.2);
});

test("13th month pay is annual basic salary divided by twelve and due by Dec 24", () => {
  assert.equal(computeThirteenthMonthPay(360_000), 30_000);
  assert.equal(computeThirteenthMonthPay(0), 0);
  assert.equal(thirteenthMonthDeadline(2026), "2026-12-24");
});

test("RR 29-2025 de minimis ceilings are explicit and excess enters other-benefits pool", () => {
  assert.equal(DE_MINIMIS_2026.riceSubsidy.ceiling, 2_500);
  assert.equal(DE_MINIMIS_2026.uniformClothing.ceiling, 8_000);
  assert.equal(DE_MINIMIS_2026.medicalCashDependents.ceiling, 2_000);
  assert.equal(DE_MINIMIS_2026.laundry.ceiling, 400);

  const within = deMinimisTreatment("riceSubsidy", 2_500);
  assert.equal(within.exempt, 2_500);
  assert.equal(within.excess, 0);
  assert.equal(within.treatment, "fully_de_minimis_exempt");

  const over = deMinimisTreatment("uniformClothing", 9_000);
  assert.equal(over.exempt, 8_000);
  assert.equal(over.excess, 1_000);
  assert.equal(over.treatment, "excess_to_other_benefits_90k_pool");
});

test("government remittances are due on the 10th of the following month", () => {
  assert.equal(statutoryDueDate(2026, 1), "2026-02-10");
  assert.equal(statutoryDueDate(2026, 12), "2027-01-10");
});

test("pay intervals cannot exceed 16 calendar days", () => {
  assert.equal(isValidPayInterval("2026-03-01", "2026-03-15"), true);
  assert.equal(isValidPayInterval("2026-03-16", "2026-03-31"), true);
  assert.equal(isValidPayInterval("2026-03-01", "2026-03-17"), false);
  assert.equal(isValidPayInterval("2026-03-17", "2026-03-01"), false);
});
