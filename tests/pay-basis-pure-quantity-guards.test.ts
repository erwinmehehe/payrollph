import assert from "node:assert/strict";
import test from "node:test";
import {
  attendanceDeductionsForCutoff,
  basicPayForCutoff,
  leaveAdjustmentForCutoff,
  resolvePayProfile,
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
