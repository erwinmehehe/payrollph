import assert from "node:assert/strict";
import test from "node:test";
import {
  compareFreelancerTax,
  computeAnnualWithholdingTax,
  computePagIbig,
  computePhilHealth,
  computeSss,
  computeMonthlyWithholdingTax,
  computeSemiMonthlyWithholdingTax,
  deriveClockHours,
  holidayMultiplier,
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
  assert.equal(computeSss(24_260).monthlySalaryCredit, 24_500);
});

test("PhilHealth splits the capped five percent premium", () => {
  assert.deepEqual(computePhilHealth(8_000), { base: 10_000, employee: 250, employer: 250 });
  assert.deepEqual(computePhilHealth(40_000), { base: 40_000, employee: 1000, employer: 1000 });
  assert.equal(computePhilHealth(150_000).employee, 2500);
});

test("Pag-IBIG uses the 2026 PHP 10,000 fund-salary cap", () => {
  assert.equal(computePagIbig(1_500).employee, 15);
  assert.equal(computePagIbig(1_500).employer, 30);
  assert.equal(computePagIbig(5_000).employee, 100);
  assert.equal(computePagIbig(10_000).employee, 200);
  assert.equal(computePagIbig(40_000).employee, 200);
});

test("TRAIN withholding brackets and MWE exemption are explicit", () => {
  assert.equal(computeAnnualWithholdingTax(250_000), 0);
  assert.equal(computeAnnualWithholdingTax(300_000), 7500);
  assert.equal(computeAnnualWithholdingTax(600_000), 62_500);
  assert.equal(computeAnnualWithholdingTax(3_000_000), 702_500);
  assert.equal(computeAnnualWithholdingTax(10_000_000), 2_902_500);
  assert.equal(computeAnnualWithholdingTax(10_000_000, true), 0);
});

test("holiday and rest day premium stacking is deterministic", () => {
  assert.equal(holidayMultiplier({ holiday: "regular", worked: false }), 1);
  assert.equal(holidayMultiplier({ holiday: "special", worked: false }), 0);
  assert.equal(holidayMultiplier({ holiday: "ordinary", worked: true }), 1);
  assert.equal(holidayMultiplier({ holiday: "special", worked: true }), 1.3);
  assert.equal(holidayMultiplier({ holiday: "special", worked: true, restDay: true }), 1.5);
  assert.equal(holidayMultiplier({ holiday: "regular", worked: true, restDay: true }), 2.6);
  assert.equal(holidayMultiplier({ holiday: "regular", worked: true, restDay: true, overtime: true }), 3.38);
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

  const incomplete = deriveClockHours({ timeIn: "2026-03-10T09:00" }, { start: "09:00", end: "18:00" });
  assert.equal(incomplete.workedMinutes, 0);
  assert.equal(incomplete.flags.length, 1);
});

test("freelancer comparison recommends the lower modeled option", () => {
  const result = compareFreelancerTax(984_000, 180_000);
  assert.equal(result.flatEightPercent, 58_720);
  assert.equal(result.graduated, 103_500);
  assert.equal(result.recommended, "8% flat");
});

test("BIR monthly and semi-monthly 2023+ boundary tables are explicit", () => {
  assert.equal(computeMonthlyWithholdingTax(20_833), 0);
  assert.equal(computeMonthlyWithholdingTax(20_834), 0.15);
  assert.equal(computeMonthlyWithholdingTax(33_333), 1_875);
  assert.equal(computeMonthlyWithholdingTax(66_667), 8_541.8);
  assert.equal(computeMonthlyWithholdingTax(166_667), 33_541.8);
  assert.equal(computeMonthlyWithholdingTax(666_667), 183_541.8);

  assert.equal(computeSemiMonthlyWithholdingTax(10_417), 0);
  assert.equal(computeSemiMonthlyWithholdingTax(10_418), 0.15);
  assert.equal(computeSemiMonthlyWithholdingTax(16_667), 937.5);
  assert.equal(computeSemiMonthlyWithholdingTax(33_333), 4_270.7);
  assert.equal(computeSemiMonthlyWithholdingTax(83_333), 16_770.7);
  assert.equal(computeSemiMonthlyWithholdingTax(333_333), 91_770.7);
  assert.equal(computeSemiMonthlyWithholdingTax(500_000), 150_104.15);
  assert.equal(computeSemiMonthlyWithholdingTax(500_000, true), 0);
});
