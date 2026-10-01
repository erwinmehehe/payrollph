import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { holidayMultiplier, type HolidayType } from "../src/lib/payroll-rules";

/**
 * Cross-checks holidayMultiplier against open-payroll-data/philippines-payroll-data
 * (MIT), pinned in tests/fixtures/open-payroll-data (see that folder's README).
 * That file's own provenance note says the combined-multiplier matrix is
 * transcribed verbatim from the DOLE Handbook on Workers' Statutory Monetary
 * Benefits (2024 ed.) "Guide Computations" table, with the percentage products
 * (e.g. regular-holiday OT = 200% x 1.30 = 260%) independently re-derived by
 * its authors, and marked "volatility: stable" (statutory minimums, unchanged
 * 2022-2026). That is a materially stronger claim than the "continuously-
 * changing" minimum-wage table, so this test does assert exact equality.
 *
 * What this function does NOT cover, and this file does not test:
 *   - Night-shift differential. The matrix's "+ Night shift" and "+ Night
 *     shift and OT" columns compound multiplicatively (day multiplier x 1.10).
 *     Linaw computes night differential separately in payroll-engine.ts as a
 *     flat +10% of the base hourly rate, added rather than compounded with the
 *     day's holiday/rest-day premium. That is a real gap in the engine, not in
 *     this function, and is not fixed here.
 *   - Double holiday (two regular holidays on the same calendar date, 300% /
 *     390% OT). HolidayType has no "double" case.
 *   - Rest-day pay in production. holidayMultiplier takes a restDay flag and
 *     computes it correctly (checked below), but payroll-engine.ts never
 *     passes restDay: true, there is no rest-day concept anywhere in the
 *     employee/shift schema, so rest-day premium pay is not paid today.
 */

type MatrixRow = { day: string; regular: number; night: number; overtime: number; night_overtime: number };
const premiumPay = JSON.parse(readFileSync("tests/fixtures/open-payroll-data/premium_pay.json", "utf8")) as {
  volatility: string;
  rules: { overtime_ordinary: number; overtime_premium_day: number; night_differential: number };
  matrix: MatrixRow[];
};

function row(day: string): MatrixRow {
  const found = premiumPay.matrix.find((item) => item.day === day);
  assert.ok(found, `reference matrix has no row for "${day}"`);
  return found;
}

test("the reference confirms premium pay is a stable statutory minimum, not a volatile figure", () => {
  assert.equal(premiumPay.volatility, "stable");
  assert.equal(premiumPay.rules.overtime_ordinary, 0.25);
  assert.equal(premiumPay.rules.overtime_premium_day, 0.3);
  assert.equal(premiumPay.rules.night_differential, 0.1);
});

const CASES: Array<{ label: string; holiday: HolidayType; restDay: boolean; matrixDay: string }> = [
  { label: "ordinary day", holiday: "ordinary", restDay: false, matrixDay: "ordinary" },
  { label: "rest day (no holiday)", holiday: "ordinary", restDay: true, matrixDay: "rest_day" },
  { label: "special non-working day", holiday: "special", restDay: false, matrixDay: "special_non_working" },
  { label: "special day on a rest day", holiday: "special", restDay: true, matrixDay: "special_on_rest_day" },
  { label: "regular holiday", holiday: "regular", restDay: false, matrixDay: "regular_holiday" },
  { label: "regular holiday on a rest day", holiday: "regular", restDay: true, matrixDay: "regular_holiday_on_rest_day" },
];

test("worked, no overtime: every representable day type matches the reference's 'Regular' column", () => {
  for (const { label, holiday, restDay, matrixDay } of CASES) {
    const got = holidayMultiplier({ holiday, worked: true, restDay });
    assert.equal(got, row(matrixDay).regular, label);
  }
});

test("worked with overtime: every representable day type matches the reference's 'Overtime' column", () => {
  for (const { label, holiday, restDay, matrixDay } of CASES) {
    const got = holidayMultiplier({ holiday, worked: true, restDay, overtime: true });
    assert.equal(got, row(matrixDay).overtime, label);
  }
});

test("an unworked regular holiday still pays 100%, an unworked special or ordinary day pays nothing", () => {
  assert.equal(holidayMultiplier({ holiday: "regular", worked: false }), 1, "Art. 94: qualified employee, holiday not worked");
  assert.equal(holidayMultiplier({ holiday: "special", worked: false }), 0, "no work, no pay on an unworked special day");
  assert.equal(holidayMultiplier({ holiday: "ordinary", worked: false }), 0);
});

test("double holiday is not representable: HolidayType has no case for it, and the reference's 300%/390% rows are unused here", () => {
  const holidayTypes: HolidayType[] = ["ordinary", "regular", "special"];
  assert.ok(!(holidayTypes as string[]).includes("double"));
  // Document the figures this gap leaves unhandled, so a future HolidayType
  // addition has something to check itself against.
  assert.equal(row("double_holiday").regular, 3);
  assert.equal(row("double_holiday").overtime, 3.9);
  assert.equal(row("double_holiday_on_rest_day").overtime, 5.07);
});
