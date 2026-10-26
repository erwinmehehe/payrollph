import assert from "node:assert/strict";
import test from "node:test";
import {
  attendanceDeductionsForCutoff,
  basicPayForCutoff,
  leaveAdjustmentForCutoff,
  resolvePayProfile,
  resolvePayTimeline,
  effectivePayProfileForDate,
  monthlyRetroForReleasedCutoff,
  profileForDate,
} from "../src/lib/pay-basis";

const monthly = resolvePayProfile({
  payBasis: "monthly", rateAmount: 22_000,
  standardWorkDaysPerMonth: 22, standardHoursPerDay: 8,
});
const daily = resolvePayProfile({
  payBasis: "daily", rateAmount: 1_000,
  standardWorkDaysPerMonth: 22, standardHoursPerDay: 8,
});
const hourly = resolvePayProfile({
  payBasis: "hourly", rateAmount: 125,
  standardWorkDaysPerMonth: 22, standardHoursPerDay: 8,
});

test("attendance quantities reject NaN and infinities for every pay basis", () => {
  for (const profile of [monthly, daily, hourly]) {
    for (const invalid of [Number.NaN, Infinity, -Infinity]) {
      assert.throws(() => attendanceDeductionsForCutoff(profile, invalid, 0), /Tardiness minutes must be finite/);
      assert.throws(() => attendanceDeductionsForCutoff(profile, 0, invalid), /Undertime minutes must be finite/);
    }
  }
});

test("leave days reject non-finite inputs before selecting pay-basis behavior", () => {
  for (const profile of [monthly, daily, hourly]) {
    for (const invalid of [Number.NaN, Infinity, -Infinity]) {
      assert.throws(() => leaveAdjustmentForCutoff({ profile, paidDays: invalid, unpaidDays: 0 }), /Paid leave days must be finite/);
      assert.throws(() => leaveAdjustmentForCutoff({ profile, paidDays: 0, unpaidDays: invalid }), /Unpaid leave days must be finite/);
    }
  }
});

test("finite zero, negative correction quantities and valid pay calculations are unchanged", () => {
  assert.equal(basicPayForCutoff(monthly, 450), 11_000);
  assert.equal(basicPayForCutoff(daily, 450), 937.5);
  assert.equal(basicPayForCutoff(hourly, 450), 937.5);
  assert.deepEqual(attendanceDeductionsForCutoff(monthly, -5, 30), {
    tardinessDeduction: 0, undertimeDeduction: 62.5,
  });
  assert.deepEqual(attendanceDeductionsForCutoff(daily, 30, -5), {
    tardinessDeduction: 0, undertimeDeduction: 0,
  });
  assert.equal(leaveAdjustmentForCutoff({ profile: monthly, paidDays: -1, unpaidDays: 1 }), -1_000);
  assert.equal(leaveAdjustmentForCutoff({ profile: monthly, paidDays: 1, unpaidDays: -1 }), 0);
  assert.equal(leaveAdjustmentForCutoff({ profile: daily, paidDays: 1, unpaidDays: -1 }), 1_000);
  assert.equal(leaveAdjustmentForCutoff({ profile: hourly, paidDays: 1, unpaidDays: 0 }), 1_000);
});

test("finite but unrepresentably large inputs cannot produce unsafe money results", () => {
  assert.throws(() => basicPayForCutoff(hourly, Number.MAX_VALUE), /safe centavo range/);
  assert.throws(() => attendanceDeductionsForCutoff(monthly, Number.MAX_VALUE, 0), /safe centavo range/);
  assert.throws(() => leaveAdjustmentForCutoff({ profile: monthly, paidDays: 0, unpaidDays: Number.MAX_VALUE }), /safe centavo range/);
  assert.throws(() => leaveAdjustmentForCutoff({ profile: daily, paidDays: Number.MAX_VALUE, unpaidDays: 0 }), /safe centavo range/);
});

test("invalid calendar days cannot roll into a different effective payroll period", () => {
  const profile = { payBasis: "monthly", rateAmount: 22_000,
    standardWorkDaysPerMonth: 22, standardHoursPerDay: 8 };
  const invalid = ["2026-02-30", "2026-02-29", "2026-04-31",
    "2026-11-31", "2026-01-00", "2026-13-01", "2026-03-1", "not-a-date"];
  for (const day of invalid) {
    assert.throws(() => resolvePayTimeline({ currentProfile: profile, revisions: [],
      periodStart: day, periodEnd: "2026-12-31" }), /Invalid payroll date/);
    assert.throws(() => effectivePayProfileForDate({ currentProfile: profile,
      revisions: [], workDate: day }), /Invalid payroll date/);
    assert.throws(() => monthlyRetroForReleasedCutoff({ previousMonthlyRate: 20_000,
      newMonthlyRate: 22_000, effectiveDate: day,
      periodStart: "2026-02-01", periodEnd: "2026-12-31" }), /Invalid payroll date/);
  }
});

test("malformed effective revision dates are rejected even if outside the requested payroll period", () => {
  const profile = { payBasis: "monthly", rateAmount: 22_000,
    standardWorkDaysPerMonth: 22, standardHoursPerDay: 8 };
  const revision = { effectiveDate: "2026-02-30",
    previousPayBasis: "monthly", previousRateAmount: 20_000,
    previousStandardWorkDaysPerMonth: 22, previousStandardHoursPerDay: 8,
    newPayBasis: "monthly", newRateAmount: 22_000,
    newStandardWorkDaysPerMonth: 22, newStandardHoursPerDay: 8 };
  assert.throws(() => resolvePayTimeline({ currentProfile: profile, revisions: [revision],
    periodStart: "2026-04-01", periodEnd: "2026-04-15" }), /Invalid payroll date/);
  assert.throws(() => effectivePayProfileForDate({ currentProfile: profile,
    revisions: [revision], workDate: "2026-04-01" }), /Invalid payroll date/);
});

test("actual leap days stay valid for payroll periods and retro dates", () => {
  const profile = { payBasis: "monthly", rateAmount: 22_000,
    standardWorkDaysPerMonth: 22, standardHoursPerDay: 8 };
  const timeline = resolvePayTimeline({ currentProfile: profile, revisions: [],
    periodStart: "2028-02-29", periodEnd: "2028-03-01" });
  assert.equal(timeline.length, 1);
  assert.equal(profileForDate(timeline, "2028-02-29").rateAmount, 22_000);
  assert.equal(effectivePayProfileForDate({ currentProfile: profile, revisions: [],
    workDate: "2028-02-29" }).rateAmount, 22_000);
  assert.ok(monthlyRetroForReleasedCutoff({ previousMonthlyRate: 20_000,
    newMonthlyRate: 22_000, effectiveDate: "2028-02-29",
    periodStart: "2028-02-16", periodEnd: "2028-02-29" }) > 0);
  assert.throws(() => profileForDate(timeline, "2026-02-30"), /Invalid payroll date/);
});
