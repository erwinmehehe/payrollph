import assert from "node:assert/strict";
import test from "node:test";
import {
  compareFreelancerTax,
  computeAnnualWithholdingTax,
  computePagIbig,
  computePhilHealth,
  computeSss,
  deriveClockHours,
  holidayMultiplier,
  isRestDayOfWeek,
  REST_DAY_NAMES,
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
  // 2026-01-04 is a Sunday.
  assert.equal(isRestDayOfWeek("2026-01-04", "Sunday"), true);
  assert.equal(isRestDayOfWeek("2026-01-04", "Monday"), false);
  // 2026-01-01 is a Thursday.
  assert.equal(isRestDayOfWeek("2026-01-01", "Thursday"), true);
  assert.equal(isRestDayOfWeek("2026-01-01", "Sunday"), false);
  // No rest day configured, same as before this existed, must never match.
  assert.equal(isRestDayOfWeek("2026-01-04", null), false);
  assert.equal(isRestDayOfWeek("2026-01-04", undefined), false);
  assert.equal(isRestDayOfWeek("2026-01-04", ""), false);
  // A bad value fails closed rather than throwing or matching anything.
  assert.equal(isRestDayOfWeek("2026-01-04", "Sundayy"), false);
  assert.equal(isRestDayOfWeek("not-a-date", "Sunday"), false);
});

test("freelancer comparison recommends the lower modeled option", () => {
  const result = compareFreelancerTax(984_000, 180_000);
  assert.equal(result.flatEightPercent, 58_720);
  assert.equal(result.graduated, 103_500);
  assert.equal(result.recommended, "8% flat");
});
