import assert from "node:assert/strict";
import test from "node:test";
import {
  computeBirSemiMonthly,
  computePagIbig,
  computePhilHealth,
  computePunchPay,
  computeSss,
  computeStatutoryCutoff,
  getRegionalWageFloor,
} from "../src/lib/ph-payroll";

test("SSS 2025 schedule uses 15% total, 5/10 split, MPF above 20k, and EC", () => {
  const sss = computeSss(38_500);
  assert.equal(sss.msc, 35_000);
  assert.equal(sss.regularMsc, 20_000);
  assert.equal(sss.mpfMsc, 15_000);
  assert.equal(sss.employeeMonthly, 1_750);
  assert.equal(sss.employerMonthly, 3_530);
  assert.equal(sss.employeeCutoff, 875);
  assert.equal(sss.employerCutoff, 1_765);
});

test("PhilHealth 5% uses 10k floor and 100k ceiling, split 50/50 and per cutoff", () => {
  assert.deepEqual(computePhilHealth(8_000), {
    base: 10_000,
    premiumMonthly: 500,
    employeeMonthly: 250,
    employerMonthly: 250,
    employeeCutoff: 125,
    employerCutoff: 125,
  });
  assert.equal(computePhilHealth(150_000).premiumMonthly, 5_000);
});

test("Pag-IBIG caps Monthly Fund Salary at 10k and uses tiered employee rate", () => {
  assert.equal(computePagIbig(1_500).employeeMonthly, 15);
  const p = computePagIbig(38_500);
  assert.equal(p.base, 10_000);
  assert.equal(p.employeeRate, 0.02);
  assert.equal(p.employeeMonthly, 200);
  assert.equal(p.employerMonthly, 200);
  assert.equal(p.employeeCutoff, 100);
});

test("BIR Annex E semi-monthly brackets use 2023-onward TRAIN rates", () => {
  assert.equal(computeBirSemiMonthly(10_417), 0);
  assert.equal(computeBirSemiMonthly(15_000), 687.45);
  assert.equal(computeBirSemiMonthly(20_000), 1_604.1);
  assert.equal(computeBirSemiMonthly(50_000), 8_437.45);
});

test("current 2026 wage references are used for MWE screening", () => {
  assert.equal(getRegionalWageFloor("NCR"), 755);
  assert.equal(getRegionalWageFloor("III"), 600);
  assert.equal(getRegionalWageFloor("IVA"), 600);
  assert.equal(getRegionalWageFloor("VII"), 540);
  assert.equal(getRegionalWageFloor("XI"), 540);
});

test("punch-to-pay premiums and tardiness derive from hourly rate", () => {
  const p = computePunchPay({
    monthlyBasic: 36_500,
    annualDivisor: 365,
    overtimeHours: 2,
    nightDiffHours: 4,
    holidayHours: 8,
    tardyMinutes: 30,
  });
  assert.equal(p.dailyRate, 1_200);
  assert.equal(p.hourlyRate, 150);
  assert.equal(p.overtimePay, 375);
  assert.equal(p.nightDiffPay, 60);
  assert.equal(p.holidayPay, 2_400);
  assert.equal(p.tardinessDeduction, 75);
});

test("cutoff calculator divides monthly statutory shares by two and applies MWE zero tax", () => {
  const regular = computeStatutoryCutoff({ monthlyBasic: 38_500, region: "NCR" });
  assert.equal(regular.sss.employeeCutoff, 875);
  assert.equal(regular.pagIbig.employeeCutoff, 100);
  assert.equal(regular.mwe, false);
  assert.ok(regular.tax > 0);

  const mwe = computeStatutoryCutoff({ monthlyBasic: 18_000, region: "NCR" });
  assert.equal(mwe.mwe, true);
  assert.equal(mwe.tax, 0);
});
