import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { holidayMultiplier, type HolidayType } from "../src/lib/payroll-rules";

/**
 * Cross-checks Linaw's premium-day multiplier function against the pinned
 * open-payroll-data transcription of the DOLE 2024 handbook matrix.
 *
 * Rest-day premium is now wired into the production payroll engine and night
 * differential is compounded with the applicable regular/OT day multiplier.
 * The engine-level DB tests remain the proof that those multipliers are used
 * on real punches; this file independently pins the statutory matrix itself.
 */

type MatrixRow = {
  day: string;
  regular: number;
  night: number;
  overtime: number;
  night_overtime: number;
};

const premiumPay = JSON.parse(
  readFileSync("tests/fixtures/open-payroll-data/premium_pay.json", "utf8"),
) as {
  volatility: string;
  rules: {
    overtime_ordinary: number;
    overtime_premium_day: number;
    night_differential: number;
  };
  matrix: MatrixRow[];
};

function row(day: string): MatrixRow {
  const found = premiumPay.matrix.find((item) => item.day === day);
  assert.ok(found, `reference matrix has no row for "${day}"`);
  return found;
}

const CASES: Array<{
  label: string;
  holiday: HolidayType;
  restDay: boolean;
  matrixDay: string;
}> = [
  { label: "ordinary day", holiday: "ordinary", restDay: false, matrixDay: "ordinary" },
  { label: "rest day", holiday: "ordinary", restDay: true, matrixDay: "rest_day" },
  { label: "special non-working day", holiday: "special", restDay: false, matrixDay: "special_non_working" },
  { label: "special day on rest day", holiday: "special", restDay: true, matrixDay: "special_on_rest_day" },
  { label: "regular holiday", holiday: "regular", restDay: false, matrixDay: "regular_holiday" },
  { label: "regular holiday on rest day", holiday: "regular", restDay: true, matrixDay: "regular_holiday_on_rest_day" },
  { label: "double regular holiday", holiday: "double", restDay: false, matrixDay: "double_holiday" },
  { label: "double regular holiday on rest day", holiday: "double", restDay: true, matrixDay: "double_holiday_on_rest_day" },
];

const milli = (value: number) => Math.round((value + Number.EPSILON) * 1000) / 1000;

test("the reference marks the premium matrix stable and pins the three component rates", () => {
  assert.equal(premiumPay.volatility, "stable");
  assert.equal(premiumPay.rules.overtime_ordinary, 0.25);
  assert.equal(premiumPay.rules.overtime_premium_day, 0.3);
  assert.equal(premiumPay.rules.night_differential, 0.1);
});

test("every representable worked day matches the reference regular multiplier", () => {
  for (const { label, holiday, restDay, matrixDay } of CASES) {
    assert.equal(
      holidayMultiplier({ holiday, worked: true, restDay }),
      row(matrixDay).regular,
      label,
    );
  }
});

test("every representable worked day matches the reference overtime multiplier", () => {
  for (const { label, holiday, restDay, matrixDay } of CASES) {
    assert.equal(
      holidayMultiplier({ holiday, worked: true, restDay, overtime: true }),
      row(matrixDay).overtime,
      label,
    );
  }
});

test("night differential compounds with the same regular and OT premium multipliers", () => {
  for (const { label, holiday, restDay, matrixDay } of CASES) {
    const regular = holidayMultiplier({ holiday, worked: true, restDay });
    const overtime = holidayMultiplier({ holiday, worked: true, restDay, overtime: true });
    assert.equal(milli(regular * 1.1), row(matrixDay).night, `${label}: night regular`);
    assert.equal(milli(overtime * 1.1), row(matrixDay).night_overtime, `${label}: night overtime`);
  }
});

test("unworked regular holiday pays 100%, double regular holiday 200%, special/ordinary zero", () => {
  assert.equal(holidayMultiplier({ holiday: "regular", worked: false }), 1);
  assert.equal(holidayMultiplier({ holiday: "double", worked: false }), 2);
  assert.equal(holidayMultiplier({ holiday: "special", worked: false }), 0);
  assert.equal(holidayMultiplier({ holiday: "ordinary", worked: false }), 0);
});
