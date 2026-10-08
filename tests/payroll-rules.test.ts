import assert from "node:assert/strict";
import test from "node:test";
import {
  compareFreelancerTax,
  computeAnnualWithholdingTax,
  computeCutoffStatutoryDeduction,
  computePagIbig,
  computePhilHealth,
  computeSemiMonthlyWithholdingTax,
  computeSss,
  deriveClockHours,
  holidayMultiplier,
  isRestDayOfWeek,
  REST_DAY_NAMES,
  restDayForDate,
} from "../src/lib/payroll-rules";

test("SSS respects the 2025/2026 salary credit floor, cap, and EC employer premium", () => {
  const low = computeSss(3_000);
  assert.equal(low.monthlySalaryCredit, 5_000);
  assert.equal(low.employee, 250);
  assert.equal(low.employer, 500);
  assert.equal(low.employerEC, 10);

  const high = computeSss(35_499);
  assert.equal(high.monthlySalaryCredit, 35_000);
  assert.equal(high.employee, 1750);
  assert.equal(high.employer, 3500);
  assert.equal(high.employerEC, 30);
  assert.equal(high.regularMsc, 20_000);
  assert.equal(high.mpfMsc, 15_000);
  assert.equal(high.employeeRegular, 1_000);
  assert.equal(high.employeeMpf, 750);
  assert.equal(high.employerRegular, 2_000);
  assert.equal(high.employerMpf, 1_500);
  assert.equal(computeSss(24_260).monthlySalaryCredit, 24_500);
});


test("SSS contribution boundary matrix covers every MSC midpoint and the MPF transition", () => {
  assert.equal(computeSss(0).monthlySalaryCredit, 5_000);
  assert.equal(computeSss(4_999.99).monthlySalaryCredit, 5_000);
  assert.equal(computeSss(5_000).monthlySalaryCredit, 5_000);

  for (let msc = 5_500; msc <= 34_500; msc += 500) {
    const midpoint = msc - 250;
    assert.equal(
      computeSss(midpoint - 0.01).monthlySalaryCredit,
      msc - 500,
      `salary just below ${midpoint.toFixed(2)} should remain at MSC ${msc - 500}`,
    );
    assert.equal(
      computeSss(midpoint).monthlySalaryCredit,
      msc,
      `salary at midpoint ${midpoint.toFixed(2)} should move to MSC ${msc}`,
    );
    assert.equal(
      computeSss(msc + 249.99).monthlySalaryCredit,
      msc,
      `salary below next midpoint should remain at MSC ${msc}`,
    );
  }

  assert.equal(computeSss(19_999.99).mpfMsc, 0);
  assert.equal(computeSss(20_249.99).monthlySalaryCredit, 20_000);
  assert.equal(computeSss(20_249.99).mpfMsc, 0);
  assert.equal(computeSss(20_250).monthlySalaryCredit, 20_500);
  assert.equal(computeSss(20_250).mpfMsc, 500);
  assert.equal(computeSss(34_749.99).monthlySalaryCredit, 34_500);
  assert.equal(computeSss(34_750).monthlySalaryCredit, 35_000);
  assert.equal(computeSss(100_000).monthlySalaryCredit, 35_000);
  assert.equal(computeSss(100_000).mpfMsc, 15_000);
});

test("statutory deduction timing supports split, first-cutoff and second-cutoff policies with true-up", () => {
  assert.equal(computeCutoffStatutoryDeduction({
    monthlyTarget: 1_750,
    priorCollected: 0,
    timing: "split",
    isSecondCutoff: false,
  }), 875);
  assert.equal(computeCutoffStatutoryDeduction({
    monthlyTarget: 1_750,
    priorCollected: 875,
    timing: "split",
    isSecondCutoff: true,
  }), 875);

  assert.equal(computeCutoffStatutoryDeduction({
    monthlyTarget: 1_750,
    priorCollected: 0,
    timing: "first_cutoff",
    isSecondCutoff: false,
  }), 1_750);
  assert.equal(computeCutoffStatutoryDeduction({
    monthlyTarget: 1_750,
    priorCollected: 1_750,
    timing: "first_cutoff",
    isSecondCutoff: true,
  }), 0);
  assert.equal(computeCutoffStatutoryDeduction({
    monthlyTarget: 1_800,
    priorCollected: 1_750,
    timing: "first_cutoff",
    isSecondCutoff: true,
  }), 50);

  assert.equal(computeCutoffStatutoryDeduction({
    monthlyTarget: 1_750,
    priorCollected: 0,
    timing: "second_cutoff",
    isSecondCutoff: false,
  }), 0);
  assert.equal(computeCutoffStatutoryDeduction({
    monthlyTarget: 1_750,
    priorCollected: 0,
    timing: "second_cutoff",
    isSecondCutoff: true,
  }), 1_750);
});

test("PhilHealth splits the capped five percent premium and reconciles odd centavos", () => {
  assert.deepEqual(computePhilHealth(8_000), { base: 10_000, total: 500, employee: 250, employer: 250 });
  assert.deepEqual(computePhilHealth(40_000), { base: 40_000, total: 2000, employee: 1000, employer: 1000 });
  assert.equal(computePhilHealth(150_000).employee, 2500);

  const odd = computePhilHealth(10_000.20);
  assert.equal(odd.total, 500.01);
  assert.equal(odd.employee + odd.employer, odd.total);
  assert.deepEqual([odd.employee, odd.employer], [250, 250.01]);
});


test("PhilHealth boundary matrix covers the floor, ceiling and odd-centavo split", () => {
  assert.deepEqual(computePhilHealth(9_999.99), { base: 10_000, total: 500, employee: 250, employer: 250 });
  assert.deepEqual(computePhilHealth(10_000), { base: 10_000, total: 500, employee: 250, employer: 250 });
  assert.equal(computePhilHealth(10_000.01).base, 10_000.01);
  assert.deepEqual(computePhilHealth(100_000), { base: 100_000, total: 5_000, employee: 2_500, employer: 2_500 });
  assert.deepEqual(computePhilHealth(100_000.01), { base: 100_000, total: 5_000, employee: 2_500, employer: 2_500 });

  for (const salary of [10_000.2, 10_000.6, 33_333.33, 99_999.98]) {
    const result = computePhilHealth(salary);
    assert.equal(
      Number((result.employee + result.employer).toFixed(2)),
      result.total,
      `EE + ER must reconcile exactly at salary ${salary}`,
    );
  }
});

test("Pag-IBIG uses the 2026 PHP 10,000 fund-salary cap", () => {
  assert.equal(computePagIbig(1_500).employee, 15);
  assert.equal(computePagIbig(1_500).employer, 30);
  assert.equal(computePagIbig(5_000).employee, 100);
  assert.equal(computePagIbig(10_000).employee, 200);
  assert.equal(computePagIbig(40_000).employee, 200);
});


test("Pag-IBIG boundary matrix covers the 1%/2% transition, salary cap, and voluntary timing", () => {
  assert.deepEqual(
    computePagIbig(1_500),
    { fundSalary: 1_500, employeeRate: 0.01, employerRate: 0.02, employee: 15, employer: 30, total: 45 },
  );
  assert.equal(computePagIbig(1_500.01).employeeRate, 0.02);
  assert.equal(computePagIbig(1_500.01).employee, 30);
  assert.equal(computePagIbig(9_999.99).employee, 200);
  assert.equal(computePagIbig(9_999.99).employer, 200);
  assert.equal(computePagIbig(10_000).employee, 200);
  assert.equal(computePagIbig(10_000.01).fundSalary, 10_000);
  assert.equal(computePagIbig(50_000).total, 400);

  // Voluntary savings are a separate employee election. The cutoff scheduler
  // can split or true-up that elected amount without altering the mandatory cap.
  assert.equal(computeCutoffStatutoryDeduction({
    monthlyTarget: 1_000,
    priorCollected: 0,
    timing: "split",
    isSecondCutoff: false,
  }), 500);
  assert.equal(computeCutoffStatutoryDeduction({
    monthlyTarget: 1_000,
    priorCollected: 500,
    timing: "split",
    isSecondCutoff: true,
  }), 500);
});

test("published semi-monthly TRAIN boundaries are implemented directly", () => {
  assert.equal(computeSemiMonthlyWithholdingTax(10_417), 0);
  assert.equal(computeSemiMonthlyWithholdingTax(10_417.01), 0);
  assert.equal(computeSemiMonthlyWithholdingTax(16_667), 937.5);
  assert.equal(computeSemiMonthlyWithholdingTax(16_667.01), 937.5);
  assert.equal(computeSemiMonthlyWithholdingTax(33_333), 4_270.7);
  assert.equal(computeSemiMonthlyWithholdingTax(83_333), 16_770.7);
  assert.equal(computeSemiMonthlyWithholdingTax(333_333), 91_770.7);
});

test("TRAIN withholding brackets and MWE exemption are explicit", () => {
  assert.equal(computeAnnualWithholdingTax(250_000), 0);
  assert.equal(computeAnnualWithholdingTax(300_000), 7500);
  assert.equal(computeAnnualWithholdingTax(600_000), 62_500);
  assert.equal(computeAnnualWithholdingTax(3_000_000), 702_500);
  assert.equal(computeAnnualWithholdingTax(10_000_000), 2_902_500);
  assert.equal(computeAnnualWithholdingTax(10_000_000, true), 0);
});

test("holiday and rest day premium stacking covers special-rest and double-regular states", () => {
  assert.equal(holidayMultiplier({ holiday: "regular", worked: false }), 1);
  assert.equal(holidayMultiplier({ holiday: "special", worked: false }), 0);
  assert.equal(holidayMultiplier({ holiday: "double", worked: false }), 2);
  assert.equal(holidayMultiplier({ holiday: "ordinary", worked: true }), 1);

  assert.equal(holidayMultiplier({ holiday: "special", worked: true }), 1.3);
  assert.equal(holidayMultiplier({ holiday: "special", worked: true, overtime: true }), 1.69);
  assert.equal(holidayMultiplier({ holiday: "special", worked: true, restDay: true }), 1.5);
  assert.equal(holidayMultiplier({ holiday: "special", worked: true, restDay: true, overtime: true }), 1.95);

  assert.equal(holidayMultiplier({ holiday: "regular", worked: true, restDay: true }), 2.6);
  assert.equal(holidayMultiplier({ holiday: "regular", worked: true, restDay: true, overtime: true }), 3.38);

  assert.equal(holidayMultiplier({ holiday: "double", worked: true }), 3);
  assert.equal(holidayMultiplier({ holiday: "double", worked: true, overtime: true }), 3.9);
  assert.equal(holidayMultiplier({ holiday: "double", worked: true, restDay: true }), 3.9);
  assert.equal(holidayMultiplier({ holiday: "double", worked: true, restDay: true, overtime: true }), 5.07);

  // Payroll adds NSD as 10% of the applicable regular/OT multiplier.
  assert.equal(Number((1.5 * 1.1).toFixed(3)), 1.65);
  assert.equal(Number((1.95 * 1.1).toFixed(3)), 2.145);
  assert.equal(Number((3 * 1.1).toFixed(3)), 3.3);
  assert.equal(Number((3.9 * 1.1).toFixed(3)), 4.29);
  assert.equal(Number((5.07 * 1.1).toFixed(3)), 5.577);
});

test("clock derivation handles grace, OT, night work, and missing pairs", () => {
  const day = deriveClockHours(
    { timeIn: "2026-03-10T09:12", timeOut: "2026-03-10T19:00" },
    { start: "09:00", end: "18:00", breakMinutes: 60, graceMinutes: 5 },
  );
  assert.equal(day.workedMinutes, 528);
  assert.equal(day.tardinessMinutes, 7);
  assert.equal(day.undertimeMinutes, 0);
  assert.equal(day.overtimeMinutes, 60);
  assert.equal(day.nightDifferentialMinutes, 0);
  assert.deepEqual(day.flags, []);

  const overnight = deriveClockHours(
    { timeIn: "2026-03-10T21:45", timeOut: "2026-03-11T06:30" },
    { start: "22:00", end: "06:00", breakMinutes: 60, graceMinutes: 5 },
  );
  assert.equal(overnight.tardinessMinutes, 0);
  assert.equal(overnight.overtimeMinutes, 30);
  assert.equal(overnight.nightDifferentialMinutes, 480);
  assert.equal(overnight.nightRegularMinutes, 480);
  assert.equal(overnight.nightOvertimeMinutes, 0);

  const incomplete = deriveClockHours({ timeIn: "2026-03-10T09:00" }, { start: "09:00", end: "18:00" });
  assert.equal(incomplete.workedMinutes, 0);
  assert.equal(incomplete.flags.length, 1);
});

test("night differential splits at the overtime boundary", () => {
  const evening = deriveClockHours(
    { timeIn: "2026-03-10T14:00", timeOut: "2026-03-11T01:00" },
    { start: "14:00", end: "23:00", breakMinutes: 60, graceMinutes: 5 },
  );
  assert.equal(evening.overtimeMinutes, 120);
  assert.equal(evening.nightRegularMinutes, 60);
  assert.equal(evening.nightOvertimeMinutes, 120);
  assert.equal(evening.nightDifferentialMinutes, 180);
});

test("isRestDayOfWeek is a pure, timezone-independent day-of-week check", () => {
  assert.equal(REST_DAY_NAMES.length, 7);
  assert.equal(isRestDayOfWeek("2026-01-04", "Sunday"), true);
  assert.equal(isRestDayOfWeek("2026-01-04", "Monday"), false);
  assert.equal(isRestDayOfWeek("2026-01-01", "Thursday"), true);
  assert.equal(isRestDayOfWeek("2026-01-04", null), false);
  assert.equal(isRestDayOfWeek("2026-01-04", undefined), false);
  assert.equal(isRestDayOfWeek("2026-01-04", ""), false);
  assert.equal(isRestDayOfWeek("2026-01-04", "Sundayy"), false);
  assert.equal(isRestDayOfWeek("not-a-date", "Sunday"), false);
});

test("restDayForDate preserves the schedule that was effective on each work date", () => {
  const revisions = [
    { effectiveDate: "2026-02-01", previousRestDay: "Sunday", newRestDay: "Monday" },
    { effectiveDate: "2026-03-01", previousRestDay: "Monday", newRestDay: "Saturday" },
  ];

  assert.equal(restDayForDate("Saturday", revisions, "2026-01-15"), "Sunday");
  assert.equal(restDayForDate("Saturday", revisions, "2026-02-15"), "Monday");
  assert.equal(restDayForDate("Saturday", revisions, "2026-03-15"), "Saturday");
  assert.equal(restDayForDate("Saturday", [], "2026-01-15"), "Saturday");
});

test("freelancer comparison recommends the lower modeled option", () => {
  const result = compareFreelancerTax(984_000, 180_000);
  assert.equal(result.flatEightPercent, 58_720);
  assert.equal(result.graduated, 103_500);
  assert.equal(result.recommended, "8% flat");
});


test("statutory contribution and withholding rule packs fail closed outside certified dates", () => {
  assert.throws(() => computeSss(30_000, "2024-12-31"), /No approved SSS rule pack/);
  assert.throws(() => computePhilHealth(30_000, "2023-12-31"), /No approved PhilHealth rule pack/);
  assert.throws(() => computePagIbig(30_000, "2024-01-31"), /No approved Pag-IBIG rule pack/);
  assert.throws(() => computeSemiMonthlyWithholdingTax(25_000, false, "2022-12-31"), /No approved BIR withholding rule pack/);
});

test("current payroll dates resolve certified statutory rule packs", () => {
  assert.equal(computeSss(35_000, "2026-10-08").employee, 1_750);
  assert.equal(computePhilHealth(40_000, "2026-10-08").employee, 1_000);
  assert.equal(computePagIbig(40_000, "2026-10-08").employee, 200);
  assert.equal(computeSemiMonthlyWithholdingTax(25_000, false, "2026-10-08"), 2_604.1);
});
