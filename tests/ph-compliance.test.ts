import assert from "node:assert/strict";
import test from "node:test";
import {
  computeMonthlyWithholdingTax,
  computePagIbig,
  computeSemiMonthlyWithholdingTax,
  computeSss,
} from "../src/lib/payroll-rules";
import {
  aggregateDeMinimisForSemiMonthly,
  deMinimisStatutoryPeriodStart,
  computeThirteenthMonthPay,
  DE_MINIMIS_2026,
  deMinimisMealTreatment,
  deMinimisTreatment,
  isValidPayInterval,
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

test("semi-monthly withholding uses the published semi-monthly table directly", () => {
  assert.equal(computeSemiMonthlyWithholdingTax(10_417), 0);
  assert.equal(computeSemiMonthlyWithholdingTax(15_000), 687.45);
  assert.equal(computeSemiMonthlyWithholdingTax(16_667), 937.5);
  assert.equal(computeSemiMonthlyWithholdingTax(25_000), 2_604.1);
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

test("pay intervals cannot exceed 16 calendar days", () => {
  assert.equal(isValidPayInterval("2026-03-01", "2026-03-15"), true);
  assert.equal(isValidPayInterval("2026-03-16", "2026-03-31"), true);
  assert.equal(isValidPayInterval("2026-03-01", "2026-03-17"), false);
  assert.equal(isValidPayInterval("2026-03-17", "2026-03-01"), false);
});


test("duplicate de minimis grants share one category ceiling using actual period-to-date payments", () => {
  const grants = [
    { id: 1, benefitType: "riceSubsidy" as const, amount: 2_000, frequency: "month" as const },
    { id: 2, benefitType: "riceSubsidy" as const, amount: 2_000, frequency: "month" as const },
  ];

  const [firstCutoff] = aggregateDeMinimisForSemiMonthly(grants);
  assert.equal(firstCutoff.semiMonthlyGranted, 2_000);
  assert.equal(firstCutoff.statutoryPeriodCeiling, 2_500);
  assert.equal(firstCutoff.priorPaidInStatutoryPeriod, 0);
  assert.equal(firstCutoff.semiMonthlyExempt, 2_000);
  assert.equal(firstCutoff.semiMonthlyOtherBenefitsPool, 0);

  const [secondCutoff] = aggregateDeMinimisForSemiMonthly(grants, {
    riceSubsidy: 2_000,
  });
  assert.equal(secondCutoff.semiMonthlyGranted, 2_000);
  assert.equal(secondCutoff.remainingCeilingBeforeCutoff, 500);
  assert.equal(secondCutoff.semiMonthlyExempt, 500);
  assert.equal(secondCutoff.semiMonthlyOtherBenefitsPool, 1_500);
});

test("de minimis statutory periods reset monthly, semi-annually or annually by category", () => {
  assert.equal(deMinimisStatutoryPeriodStart("riceSubsidy", "2026-08-15"), "2026-08-01");
  assert.equal(deMinimisStatutoryPeriodStart("medicalCashDependents", "2026-04-15"), "2026-01-01");
  assert.equal(deMinimisStatutoryPeriodStart("medicalCashDependents", "2026-08-15"), "2026-07-01");
  assert.equal(deMinimisStatutoryPeriodStart("uniformClothing", "2026-08-15"), "2026-01-01");
});


test("RR 29-2025 de minimis rules are effective-dated and fail closed outside certified coverage", () => {
  assert.equal(deMinimisTreatment("riceSubsidy", 2_500, "2026-01-06").exempt, 2_500);
  assert.throws(() => deMinimisTreatment("riceSubsidy", 2_500, "2026-01-05"), /No certified BIR de minimis rule pack/);
  assert.throws(() => aggregateDeMinimisForSemiMonthly([], {}, "2027-01-01"), /No certified BIR de minimis rule pack/);
});


test("RR 29-2025 OT/night meal allowance uses 30% of verified daily minimum wage per eligible day", () => {
  const treatment = deMinimisMealTreatment({
    amountPerEligibleDay: 250,
    eligibleDays: 3,
    dailyMinimumWage: 755,
    asOf: "2026-10-08",
  });
  assert.equal(treatment.dailyCeiling, 226.5);
  assert.equal(treatment.granted, 750);
  assert.equal(treatment.ceiling, 679.5);
  assert.equal(treatment.exempt, 679.5);
  assert.equal(treatment.excess, 70.5);
});

test("OT/night meal allowance pays zero when attendance has no qualifying day", () => {
  const [result] = aggregateDeMinimisForSemiMonthly([
    {
      id: 10,
      benefitType: "otNightMealAllowance",
      amount: 200,
      frequency: "eligible_day",
      basisDailyMinimumWage: 755,
      basisWageOrder: "WO-NCR-28 applicable tier",
    },
  ], {}, "2026-10-08", { mealEligibleDays: 0 });

  assert.equal(result.semiMonthlyGranted, 0);
  assert.equal(result.semiMonthlyExempt, 0);
  assert.equal(result.semiMonthlyOtherBenefitsPool, 0);
  assert.equal(result.eligibleDays, 0);
});

test("OT/night meal allowance fails closed without an auditable minimum-wage basis", () => {
  assert.throws(
    () => aggregateDeMinimisForSemiMonthly([
      {
        id: 11,
        benefitType: "otNightMealAllowance",
        amount: 200,
        frequency: "eligible_day",
      },
    ], {}, "2026-10-08", { mealEligibleDays: 2 }),
    /requires a verified applicable daily minimum-wage basis/,
  );
});
