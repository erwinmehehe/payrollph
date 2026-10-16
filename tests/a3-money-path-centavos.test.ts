import assert from "node:assert/strict";
import test from "node:test";
import { attendanceDeductionsForCutoff, basicPayForCutoff, resolvePayProfile } from "../src/lib/pay-basis";
import { roundedGrossFromBuckets } from "../src/lib/payroll-money";
import { allocateMandatoryDeductions } from "../src/lib/payroll-mandatory-shortfall";
import {
  computeAnnualWithholdingTax, computeCutoffStatutoryDeduction, computeMonthlyWithholdingTax,
  computePagIbig, computePhilHealth, computeSemiMonthlyWithholdingTax, computeSss,
  deriveClockHours, holidayMultiplier,
} from "../src/lib/payroll-rules";
import { computeThirteenthMonthPay } from "../src/lib/ph-compliance";
import { computeFinalPay, unresolvedFinalPayMandatoryShortfall } from "../src/lib/final-pay";

// A-3: fictional, pure-function money-path fixtures only. They are NOT a payroll-engine/DB run.
// Source tables: src/lib/ph-statutory-rule-packs.ts:37-113. The repository contains
// government citations, not independently authenticated copies of the official tables.
const asCents = (value: number) => Math.round(value * 100);

type Basis = "monthly" | "daily" | "hourly";
type Day = "ordinary" | "regular" | "special" | "double";
function fictionalCutoff(input: {
  basis: Basis; rate: number; regularMinutes: number;
  overtimeHours?: number; nightHours?: number; holidayHours?: number;
  holiday?: Day; lateMinutes?: number; undertimeMinutes?: number;
}) {
  const p = resolvePayProfile({
    payBasis: input.basis, rateAmount: input.rate,
    standardWorkDaysPerMonth: 22, standardHoursPerDay: 8,
  });
  const basic = roundedGrossFromBuckets([basicPayForCutoff(p, input.regularMinutes)]);
  const overtime = roundedGrossFromBuckets([
    (input.overtimeHours ?? 0) * p.hourlyRate * holidayMultiplier({ holiday: "ordinary", worked: true, overtime: true }),
  ]);
  // This is a fixture-level 10% ND illustration, NOT a call to the DB-backed payroll engine.
  const night = roundedGrossFromBuckets([(input.nightHours ?? 0) * p.hourlyRate * 0.10]);
  const holidayPremium = roundedGrossFromBuckets([
    (input.holidayHours ?? 0) * p.hourlyRate *
      (holidayMultiplier({ holiday: input.holiday ?? "ordinary", worked: true }) - 1),
  ]);
  const gross = roundedGrossFromBuckets([basic, overtime, night, holidayPremium]);
  const { tardinessDeduction, undertimeDeduction } = attendanceDeductionsForCutoff(
    p, input.lateMinutes ?? 0, input.undertimeMinutes ?? 0,
  );
  const tardiness = roundedGrossFromBuckets([tardinessDeduction]);
  const undertime = roundedGrossFromBuckets([undertimeDeduction]);
  const firstCutoff = (monthlyTarget: number) => computeCutoffStatutoryDeduction({
    monthlyTarget, priorCollected: 0, timing: "split", isSecondCutoff: false,
  });
  const sss = firstCutoff(computeSss(p.monthlyEquivalent, "2026-10-15").employee);
  const philHealth = firstCutoff(computePhilHealth(p.monthlyEquivalent, "2026-10-15").employee);
  const pagIbig = firstCutoff(computePagIbig(p.monthlyEquivalent, "2026-10-15").employee);
  const taxable = roundedGrossFromBuckets([gross, -sss, -philHealth, -pagIbig, -tardiness, -undertime]);
  const withholding = computeSemiMonthlyWithholdingTax(taxable, false, "2026-10-15");
  const allocation = allocateMandatoryDeductions(gross, {
    sss, philHealth, pagIbig, withholding, yearEndTaxAdjustment: 0,
    tardiness, undertime,
  });
  return {
    basic, overtime, night, holidayPremium, gross,
    sss, philHealth, pagIbig, tardiness, undertime, taxable, withholding,
    deductions: allocation.appliedTotal, net: allocation.disposableBeforeOptional,
    uncollected: allocation.totalUncollected,
  };
}

function assertCentavoFooting(p: ReturnType<typeof fictionalCutoff>) {
  assert.equal(asCents(p.gross), [p.basic, p.overtime, p.night, p.holidayPremium].reduce((c, x) => c + asCents(x), 0));
  assert.equal(asCents(p.deductions), [p.sss, p.philHealth, p.pagIbig, p.withholding, p.tardiness, p.undertime]
    .reduce((c, x) => c + asCents(x), 0));
  assert.equal(asCents(p.net), asCents(p.gross) - asCents(p.deductions));
}

test("monthly, daily and hourly-equivalent fictional paychecks pin every centavo", () => {
  const monthly = fictionalCutoff({ basis: "monthly", rate: 35_200, regularMinutes: 4_800 });
  assert.deepEqual(monthly, {
    basic: 17_600, // 35,200 / 2
    overtime: 0, night: 0, holidayPremium: 0, // no extra earning hours
    gross: 17_600, // 17,600 + 0 + 0 + 0
    sss: 875, // 35,000 MSC * 5% / 2
    philHealth: 440, // 35,200 * 5% * 50% / 2
    pagIbig: 100, // 10,000 cap * 2% / 2
    tardiness: 0, undertime: 0, // zero attendance deduction minutes
    taxable: 16_185, // 17,600 - 875 - 440 - 100
    withholding: 865.20, // (16,185 - 10,417) * 15%
    deductions: 2_280.20, // 875 + 440 + 100 + 865.20
    net: 15_319.80, // 17,600 - 2,280.20
    uncollected: 0, // 17,600 covers 2,280.20 in deductions
  });
  const daily = fictionalCutoff({ basis: "daily", rate: 800, regularMinutes: 4_800 });
  assert.deepEqual(daily, {
    basic: 8_000, // 4,800 / 60 / 8 * 800
    overtime: 0, night: 0, holidayPremium: 0, // no extra earning hours
    gross: 8_000, // 8,000 + 0 + 0 + 0
    sss: 437.50, // 17,500 MSC * 5% / 2
    philHealth: 220, // (800 * 22) * 5% * 50% / 2
    pagIbig: 100, // 10,000 cap * 2% / 2
    tardiness: 0, undertime: 0, // daily pay uses worked minutes, not a separate lateness charge
    taxable: 7_242.50, // 8,000 - 437.50 - 220 - 100
    withholding: 0, // taxable 7,242.50 is below 10,417
    deductions: 757.50, // 437.50 + 220 + 100
    net: 7_242.50, // 8,000 - 757.50
    uncollected: 0, // 8,000 covers 757.50 in deductions
  });
  const hourly = fictionalCutoff({ basis: "hourly", rate: 125, regularMinutes: 4_800 });
  assert.deepEqual(hourly, {
    basic: 10_000, // 4,800 / 60 * 125
    overtime: 0, night: 0, holidayPremium: 0, // no extra earning hours
    gross: 10_000, // 10,000 + 0 + 0 + 0
    sss: 550, // 22,000 MSC * 5% / 2
    philHealth: 275, // (125 * 8 * 22) * 5% * 50% / 2
    pagIbig: 100, // 10,000 cap * 2% / 2
    tardiness: 0, undertime: 0, // no separate hourly attendance deductions
    taxable: 9_075, // 10,000 - 550 - 275 - 100
    withholding: 0, // taxable 9,075 is below 10,417
    deductions: 925, // 550 + 275 + 100
    net: 9_075, // 10,000 - 925
    uncollected: 0, // 10,000 covers 925 in deductions
  });
  for (const result of [monthly, daily, hourly]) assertCentavoFooting(result);
});

test("premium, late/undertime and repeat-input cases keep exact pay-line totals", () => {
  const monthlyInput = { basis: "monthly" as const, rate: 35_200, regularMinutes: 4_800,
    overtimeHours: 2, nightHours: 1, holidayHours: 8, holiday: "regular" as const,
    lateMinutes: 15, undertimeMinutes: 30 };
  const monthly = fictionalCutoff(monthlyInput);
  assert.deepEqual(monthly, {
    basic: 17_600, // 35,200 / 2
    overtime: 500, // 2 * 200 * 125%
    night: 20, // 1 * 200 * 10% (fixture illustration)
    holidayPremium: 1_600, // 8 * 200 * (200% - 100%)
    gross: 19_720, // 17,600 + 500 + 20 + 1,600
    sss: 875, // 35,000 MSC * 5% / 2
    philHealth: 440, // 35,200 * 5% * 50% / 2
    pagIbig: 100, // 10,000 cap * 2% / 2
    tardiness: 50, // 15 / 60 * 200
    undertime: 100, // 30 / 60 * 200
    taxable: 18_155, // 19,720 - 875 - 440 - 100 - 50 - 100
    withholding: 1_235.10, // 937.50 + (18,155 - 16,667) * 20%
    deductions: 2_800.10, // 875 + 440 + 100 + 50 + 100 + 1,235.10
    net: 16_919.90, // 19,720 - 2,800.10
    uncollected: 0, // 19,720 covers 2,800.10 in deductions
  });
  const hourly = fictionalCutoff({ basis: "hourly", rate: 125, regularMinutes: 4_800,
    overtimeHours: 2, nightHours: 1, holidayHours: 8, holiday: "special" });
  assert.deepEqual(hourly, {
    basic: 10_000, // 80 hours * 125
    overtime: 312.50, // 2 * 125 * 125%
    night: 12.50, // 1 * 125 * 10% (fixture illustration)
    holidayPremium: 300, // 8 * 125 * (130% - 100%)
    gross: 10_625, // 10,000 + 312.50 + 12.50 + 300
    sss: 550, // 22,000 MSC * 5% / 2
    philHealth: 275, // 22,000 * 5% * 50% / 2
    pagIbig: 100, // 10,000 cap * 2% / 2
    tardiness: 0, undertime: 0, // zero monthly-only attendance deductions
    taxable: 9_700, // 10,625 - 550 - 275 - 100
    withholding: 0, // taxable 9,700 is below 10,417
    deductions: 925, // 550 + 275 + 100
    net: 9_700, // 10,625 - 925
    uncollected: 0, // 10,625 covers 925 in deductions
  });
  assertCentavoFooting(monthly);
  assertCentavoFooting(hourly);
  assert.deepEqual(fictionalCutoff(monthlyInput), monthly, "same fictional input must be deterministic");
});

test("night-work minute derivation is pinned independently of fixture-level night pay", () => {
  const shift = deriveClockHours(
    { timeIn: "2026-10-14T22:00", timeOut: "2026-10-14T23:00" },
    { start: "22:00", end: "23:00", breakMinutes: 0, graceMinutes: 0 },
  );
  assert.equal(shift.workedMinutes, 60); // 23:00 - 22:00 = 60 minutes
  assert.equal(shift.nightDifferentialMinutes, 60); // 22:00-23:00 lies inside the night window
  assert.equal(shift.overtimeMinutes, 0); // scheduled finish equals actual finish
});

test("UNVERIFIED RATE - needs independent check: SSS floor, midpoints, EC and cap", () => {
  // src/lib/ph-statutory-rule-packs.ts:37-52; employee 5%, employer 10%, EC 10/30.
  const cases: Array<[number, number, number, number, number, number]> = [
    [4_999.99, 5_000, 250, 500, 10, 760], // below 5,000 floor: 5,000 * (5% + 10%) + 10
    [5_000, 5_000, 250, 500, 10, 760], // at floor: 5,000 * (5% + 10%) + 10
    [5_000.01, 5_000, 250, 500, 10, 760], // above floor, below 5,250 midpoint
    [5_249.99, 5_000, 250, 500, 10, 760], // 0.01 below 5,250 midpoint
    [5_250, 5_500, 275, 550, 10, 835], // at midpoint: 5,500 * (5% + 10%) + 10
    [5_250.01, 5_500, 275, 550, 10, 835], // above midpoint: 5,500 * 15% + 10
    [14_749.99, 14_500, 725, 1_450, 10, 2_185], // 14,500 * 15% + 10 EC
    [14_750, 15_000, 750, 1_500, 30, 2_280], // 15,000 * 15% + 30 EC
    [14_750.01, 15_000, 750, 1_500, 30, 2_280], // EC threshold exceeded; same 15,000 MSC
    [20_249.99, 20_000, 1_000, 2_000, 30, 3_030], // before MPF: 20,000 * 15% + 30
    [20_250, 20_500, 1_025, 2_050, 30, 3_105], // after MPF: 20,500 * 15% + 30
    [20_250.01, 20_500, 1_025, 2_050, 30, 3_105], // 500 MPF MSC + 20,000 regular MSC
    [34_749.99, 34_500, 1_725, 3_450, 30, 5_205], // 34,500 * 15% + 30
    [34_750, 35_000, 1_750, 3_500, 30, 5_280], // ceiling MSC: 35,000 * 15% + 30
    [34_750.01, 35_000, 1_750, 3_500, 30, 5_280], // above last midpoint, remains capped
  ];
  for (const [salary, msc, employee, employer, ec, total] of cases) {
    const actual = computeSss(salary, "2026-10-15");
    assert.deepEqual([actual.monthlySalaryCredit, actual.employee, actual.employer, actual.employerEC, actual.total],
      [msc, employee, employer, ec, total], `SSS salary ${salary}`);
  }
});

test("UNVERIFIED RATE - needs independent check: PhilHealth floor, odd cent and cap", () => {
  // src/lib/ph-statutory-rule-packs.ts:55-65; 5% premium, half EE; odd cent to ER.
  const cases: Array<[number, number, number, number, number]> = [
    [9_999.99, 10_000, 500, 250, 250], // floor: 10,000 * 5% = 500; half = 250
    [10_000, 10_000, 500, 250, 250], // at floor: 10,000 * 5% = 500
    [10_000.01, 10_000.01, 500, 250, 250], // above floor: 500.0005 rounds to 500.00
    [10_000.20, 10_000.20, 500.01, 250, 250.01], // 10,000.20 * 5%=500.01, odd cent assigned employer
    [99_999.99, 99_999.99, 5_000, 2_500, 2_500], // 99,999.99 * 5%=4,999.9995 -> 5,000
    [100_000, 100_000, 5_000, 2_500, 2_500], // at cap: 100,000 * 5%=5,000
    [100_000.01, 100_000, 5_000, 2_500, 2_500], // above cap still 5,000
  ];
  for (const [salary, base, total, employee, employer] of cases) {
    const actual = computePhilHealth(salary, "2026-10-15");
    assert.deepEqual(actual, { base, total, employee, employer }, `PHIC salary ${salary}`);
    assert.equal(asCents(actual.total), asCents(actual.employee) + asCents(actual.employer));
  }
});

test("UNVERIFIED RATE - needs independent check: Pag-IBIG 1%/2% step and salary cap", () => {
  // src/lib/ph-statutory-rule-packs.ts:68-79; EE 1% <=1,500 else 2%; ER 2%, cap 10,000.
  const cases: Array<[number, number, number, number, number]> = [
    [1_499.99, 1_499.99, 15, 30, 45], // 1,499.99 * 1%=15; *2%=30; sum45
    [1_500, 1_500, 15, 30, 45], // 1,500 * 1%=15; *2%=30; sum45
    [1_500.01, 1_500.01, 30, 30, 60], // 1,500.01 * 2%=30 EE + 30 ER
    [9_999.99, 9_999.99, 200, 200, 400], // 9,999.99 * 2%=200 each
    [10_000, 10_000, 200, 200, 400], // 10,000 * 2%=200 each
    [10_000.01, 10_000, 200, 200, 400], // above cap: 10,000 * 2%=200 each
  ];
  for (const [salary, fundSalary, employee, employer, total] of cases) {
    const actual = computePagIbig(salary, "2026-10-15");
    assert.deepEqual([actual.fundSalary, actual.employee, actual.employer, actual.total],
      [fundSalary, employee, employer, total], `HDMF salary ${salary}`);
  }
});

test("UNVERIFIED RATE - needs independent check: BIR monthly bracket centavos", () => {
  // src/lib/ph-statutory-rule-packs.ts:96-103; brackets are inclusive at upper limit.
  const cases: Array<[number, number]> = [
    [20_832.99, 0], // below tax floor: 0
    [20_833, 0], // at tax floor: 0
    [20_833.01, 0], // 0.01 * 15% rounds to 0
    [25_000, 625.05], // (25,000 - 20,833) * 15%
    [33_332.99, 1_875], // 12,499.99 * 15% -> 1,875.00
    [33_333, 1_875], // 12,500 * 15%=1,875
    [33_333.01, 1_875], // 1,875 + 0.01 * 20% rounds to 1,875.00
    [50_000, 5_208.40], // 1,875 + (50,000 - 33,333) * 20%
    [66_666.99, 8_541.80], // 1,875 + 33,333.99 * 20% -> 8,541.80
    [66_667, 8_541.80], // 1,875 + 33,334 * 20%=8,541.80
    [66_667.01, 8_541.80], // 8,541.80 + 0.01 * 25% -> 8,541.80
    [100_000, 16_875.05], // 8,541.80 + 33,333 * 25%
    [166_666.99, 33_541.80], // 8,541.80 + 99,999.99 * 25% -> 33,541.80
    [166_667, 33_541.80], // 8,541.80 + 100,000 * 25%
    [166_667.01, 33_541.80], // 33,541.80 + 0.01 * 30% -> 33,541.80
    [200_000, 43_541.70], // 33,541.80 + 33,333 * 30%
    [666_666.99, 183_541.80], // 33,541.80 + 499,999.99 * 30%
    [666_667, 183_541.80], // 33,541.80 + 500,000 * 30%
    [666_667.01, 183_541.80], // 183,541.80 + 0.01 * 35% -> 183,541.80
    [700_000, 195_208.35], // 183,541.80 + 33,333 * 35%
  ];
  for (const [salary, expected] of cases) {
    assert.equal(computeMonthlyWithholdingTax(salary, false, "2026-10-15"), expected, `monthly WHT at ${salary}`);
  }
});

test("UNVERIFIED RATE - needs independent check: BIR semi-monthly bracket centavos", () => {
  // src/lib/ph-statutory-rule-packs.ts:104-111; same table the payroll engine calls.
  const cases: Array<[number, number]> = [
    [10_416.99, 0], // below floor: 0
    [10_417, 0], // at floor: 0
    [10_417.01, 0], // 0.01 * 15% rounds to 0
    [12_500, 312.45], // (12,500 - 10,417) * 15%
    [16_666.99, 937.50], // 6,249.99 * 15% -> 937.50
    [16_667, 937.50], // 6,250 * 15%=937.50
    [16_667.01, 937.50], // 937.50 + 0.01 * 20% rounds unchanged
    [25_000, 2_604.10], // 937.50 + (25,000 - 16,667) * 20%
    [33_332.99, 4_270.70], // 937.50 + 16,665.99 * 20% -> 4,270.70
    [33_333, 4_270.70], // 937.50 + 16,666 * 20%
    [33_333.01, 4_270.70], // 4,270.70 + 0.01 * 25% rounds unchanged
    [45_000, 7_187.45], // 4,270.70 + (45,000 - 33,333) * 25%
    [83_332.99, 16_770.70], // 4,270.70 + 49,999.99 * 25% -> 16,770.70
    [83_333, 16_770.70], // 4,270.70 + 50,000 * 25%
    [83_333.01, 16_770.70], // 16,770.70 + 0.01 * 30% unchanged
    [100_000, 21_770.80], // 16,770.70 + (100,000 - 83,333) * 30%
    [333_332.99, 91_770.70], // 16,770.70 + 249,999.99 * 30%
    [333_333, 91_770.70], // 16,770.70 + 250,000 * 30%
    [333_333.01, 91_770.70], // 91,770.70 + 0.01 * 35% unchanged
    [350_000, 97_604.15], // 91,770.70 + (350,000 - 333,333) * 35%
  ];
  for (const [salary, expected] of cases) {
    assert.equal(computeSemiMonthlyWithholdingTax(salary, false, "2026-10-15"), expected, `semi-monthly WHT at ${salary}`);
  }
});

test("UNVERIFIED RATE - needs independent check: BIR annual thresholds and all marginal bands", () => {
  // src/lib/ph-statutory-rule-packs.ts:88-95; annual TRAIN brackets, 2023 onward.
  const cases: Array<[number, number]> = [
    [249_999.99, 0], // under 250,000 floor: 0
    [250_000, 0], // at 250,000 floor: 0
    [250_000.01, 0], // 0.01 * 15% rounds 0
    [300_000, 7_500], // 50,000 * 15%
    [399_999.99, 22_500], // 149,999.99 * 15% ->22,500.00
    [400_000, 22_500], // 150,000 * 15%=22,500
    [400_000.01, 22_500], // 22,500 + 0.01 * 20% unchanged
    [600_000, 62_500], // 22,500 + 200,000 * 20%
    [799_999.99, 102_500], // 22,500 + 399,999.99 * 20% ->102,500.00
    [800_000, 102_500], // 22,500 + 400,000 * 20%
    [800_000.01, 102_500], // 102,500 + 0.01 * 25% unchanged
    [1_000_000, 152_500], // 102,500 + (1,000,000 - 800,000) * 25%
    [1_999_999.99, 402_500], // 102,500 + 1,199,999.99 * 25% -> 402,500.00
    [2_000_000, 402_500], // 102,500 + 1,200,000 * 25%
    [2_000_000.01, 402_500], // 402,500 + 0.01 * 30% -> 402,500.00
    [3_000_000, 702_500], // 402,500 + 1,000,000 * 30%
    [7_999_999.99, 2_202_500], // 402,500 + 5,999,999.99 * 30% -> 2,202,500.00
    [8_000_000, 2_202_500], // 402,500 + 6,000,000 * 30%
    [8_000_000.01, 2_202_500], // 2,202,500 + 0.01 * 35% -> 2,202,500.00
    [9_000_000, 2_552_500], // 2,202,500 + 1,000,000 * 35%
  ];
  for (const [salary, expected] of cases) {
    assert.equal(computeAnnualWithholdingTax(salary, false, "2026-10-15"), expected, `annual WHT at ${salary}`);
  }
});

test("half-cent rounding pins printed earnings before summing into gross", () => {
  assert.equal(roundedGrossFromBuckets([100.005, 1.005, -0.005]), 101.02); // 100.01 + 1.01 + 0.00
  assert.equal(roundedGrossFromBuckets([0.005, 0.005]), 0.02); // 0.01 + 0.01, not raw 0.01
  assert.equal(computeThirteenthMonthPay(120_000.18), 10_000.02); // 120,000.18 / 12 = 10,000.015 -> 10,000.02
  assert.equal(computeThirteenthMonthPay(0.06), 0.01); // 0.06 / 12 = 0.005 -> 0.01
});

test("final-pay tax debt retains the signed -7,500.00 shortfall and exact unpaid liability", () => {
  const input = {
    releasedBasicYtd: 300_000, historicalBasicYtd: 0, unpaidBasicSalary: 0,
    thirteenthPaidYtd: 25_000, grossCompensationYtd: 300_000,
    statutoryContributionsYtd: 0, taxWithheldYtd: 0, mwe: false,
    leaveMonetizationPay: 0, separationPay: 0, retirementPay: 0,
    otherBenefits: 0, loanDeductions: 0,
  };
  const result = computeFinalPay(input);
  assert.equal(result.thirteenthEntitlement, 25_000); // 300,000 / 12 = 25,000
  assert.equal(result.thirteenthDue, 0); // 25,000 earned - 25,000 previously paid
  assert.equal(result.taxDue, 7_500); // (300,000 - 250,000) * 15%
  assert.equal(result.taxAdjustment, -7_500); // 0 withheld - 7,500 tax due
  assert.equal(result.grossFinalPay, 0); // no unpaid wages or benefits
  assert.equal(result.grossFinalPay + result.taxAdjustment - result.finalStatutoryDeductions, -7_500); // 0 - 7,500 - 0 = -7,500 signed liability
  assert.equal(result.unpaidTaxWithholding, 7_500); // requested 7,500 - applied 0
  assert.equal(result.unpaidMandatoryDeductions, 7_500); // unpaid tax 7,500 + unpaid statutory 0
  assert.equal(result.netFinalPay, 0); // payable floor is zero, NOT evidence the -7,500 debt vanished
  assert.equal(unresolvedFinalPayMandatoryShortfall({
    grossFinalPay: "0.00", taxAdjustment: "-7500.00", finalStatutoryDeductions: "0.00",
  }), 7_500); // 0 - (-7,500) - 0 = 7,500 unresolved
  assert.deepEqual(computeFinalPay(input), result, "final-pay rerun is idempotent");
});

// These were TODO-only observations. Execute both the default-off contract and fixes.
test("A-3/M-3: signed final-pay deficit is exposed without creating a negative payout", () => {
  const before = process.env.FINAL_PAY_SIGNED_REVIEW_ENABLED;
  const input = { releasedBasicYtd: 300000, historicalBasicYtd: 0, unpaidBasicSalary: 0,
    thirteenthPaidYtd: 25000, grossCompensationYtd: 300000, statutoryContributionsYtd: 0,
    taxWithheldYtd: 0, mwe: false, leaveMonetizationPay: 0, separationPay: 0,
    retirementPay: 0, otherBenefits: 0, loanDeductions: 0 };
  try {
    delete process.env.FINAL_PAY_SIGNED_REVIEW_ENABLED;
    const legacy = computeFinalPay(input);
    assert.equal("signedNetFinalPay" in legacy, false);
    process.env.FINAL_PAY_SIGNED_REVIEW_ENABLED = "true";
    const result = computeFinalPay(input);
    assert.equal(result.signedNetFinalPay, -7500);
    assert.equal(result.netFinalPay, 0);
    assert.equal(result.unpaidTaxWithholding, 7500);
    const { signedNetFinalPay: _signed, ...unchanged } = result;
    assert.deepEqual(unchanged, legacy);
  } finally { if (before === undefined) delete process.env.FINAL_PAY_SIGNED_REVIEW_ENABLED; else process.env.FINAL_PAY_SIGNED_REVIEW_ENABLED = before; }
});
test("A-3: 120000.06 / 12 uses exact-centavo half-up only with the release flag", () => {
  const before = process.env.EXACT_THIRTEENTH_CENTAVOS_ENABLED;
  try {
    delete process.env.EXACT_THIRTEENTH_CENTAVOS_ENABLED;
    assert.equal(computeThirteenthMonthPay(120000.06), 10000);
    process.env.EXACT_THIRTEENTH_CENTAVOS_ENABLED = "true";
    assert.equal(computeThirteenthMonthPay(120000.06), 10000.01);
    assert.equal(computeThirteenthMonthPay(120000.18), 10000.02);
    assert.equal(computeThirteenthMonthPay(0.05), 0);
    assert.equal(computeThirteenthMonthPay(0.06), 0.01);
    assert.throws(() => computeThirteenthMonthPay(Infinity));
  } finally { if (before === undefined) delete process.env.EXACT_THIRTEENTH_CENTAVOS_ENABLED; else process.env.EXACT_THIRTEENTH_CENTAVOS_ENABLED = before; }
});
