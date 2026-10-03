import assert from "node:assert/strict";
import test from "node:test";
import { holidayMultiplier } from "../src/lib/payroll-rules";
import { holidayOn, isBelowMinimum, wageOrderFor, WAGE_ORDERS } from "../src/lib/wage-orders";

test("NCR minimum wage is WO-NCR-26 at PHP 695/day", () => {
  const order = wageOrderFor("NCR");
  assert.equal(order.wageOrder, "WO-NCR-26");
  assert.equal(order.dailyRate, 695);
  assert.equal(order.effectiveOn, "2025-07-18");
});

test("a ₱14,000 monthly rate is below the NCR floor and treated as MWE-adjacent", () => {
  const check = isBelowMinimum(14_000, "NCR");
  assert.equal(check.below, true);
  assert.ok(check.impliedDaily < 645);
});

test("a ₱38,500 monthly rate is above the NCR floor", () => {
  assert.equal(isBelowMinimum(38_500, "NCR").below, false);
});

test("Black Saturday 2026 is recognized and no demo holiday leaks into the national calendar", () => {
  const holiday = holidayOn("2026-04-04");
  assert.ok(holiday);
  assert.equal(holiday?.kind, "special");
  assert.equal(holidayOn("2026-03-11"), null);
  const multiplier = holidayMultiplier({ holiday: "special", worked: true });
  assert.equal(multiplier, 1.3);
});

test("Christmas is a regular holiday at 200% when worked", () => {
  const holiday = holidayOn("2026-12-25");
  assert.equal(holiday?.kind, "regular");
  assert.equal(holidayMultiplier({ holiday: "regular", worked: true }), 2);
});

/**
 * WAGE_ORDERS covers all 17 NWPC regions (16 regional boards + BARMM), but
 * every row is transcribed from a third-party reference, not confirmed
 * against NWPC or the region's own RTWPB order directly. See the file's own
 * comment. These tests hold the code to that honesty, not to any particular
 * rate: they do not assert what the rates are, only that nothing claims they
 * are verified when they are not.
 */
test("every wage order is explicitly marked unverified, and nothing in isBelowMinimum hides that", () => {
  assert.equal(WAGE_ORDERS.length, 17);
  for (const order of WAGE_ORDERS) {
    assert.equal(order.verified, false, `${order.region} must stay marked unverified until someone checks NWPC directly`);
  }
  // isBelowMinimum still returns the order it used, so a caller can show the
  // same "unverified" flag next to any underpayment finding.
  assert.equal(isBelowMinimum(20_000, "XI").order.verified, false);
});

test("every region has exactly one wage order, and the hire form's dropdown has a region to pick from", () => {
  const regions = WAGE_ORDERS.map((order) => order.region);
  assert.equal(new Set(regions).size, regions.length, "no duplicate region keys");
  for (const region of ["NCR", "CAR", "I", "II", "III", "IV-A", "IV-B", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "BARMM"]) {
    assert.ok(regions.includes(region), `missing region ${region}`);
  }
});
