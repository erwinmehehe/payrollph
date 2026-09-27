import assert from "node:assert/strict";
import test from "node:test";
import { holidayMultiplier } from "../src/lib/payroll-rules";
import { holidayOn, isBelowMinimum, wageOrderFor } from "../src/lib/wage-orders";

test("NCR wage screening uses the configured current lower screening rate", () => {
  const order = wageOrderFor("NCR");
  assert.match(order.wageOrder, /screening floor/);
  assert.equal(order.dailyRate, 718);
  assert.equal(order.effectiveOn, "2026-07-25");
});

test("a ₱14,000 monthly rate is below the NCR screening floor", () => {
  const check = isBelowMinimum(14_000, "NCR");
  assert.equal(check.below, true);
  assert.ok(check.impliedDaily < 718);
});

test("a ₱38,500 monthly rate is above the NCR floor", () => {
  assert.equal(isBelowMinimum(38_500, "NCR").below, false);
});

test("Chinese New Year special non-working day is recognized", () => {
  const holiday = holidayOn("2026-02-17");
  assert.ok(holiday);
  assert.equal(holiday?.kind, "special");
  const multiplier = holidayMultiplier({ holiday: "special", worked: true });
  assert.equal(multiplier, 1.3);
});

test("Christmas is a regular holiday at 200% when worked", () => {
  const holiday = holidayOn("2026-12-25");
  assert.equal(holiday?.kind, "regular");
  assert.equal(holidayMultiplier({ holiday: "regular", worked: true }), 2);
});


test("company-specific annual divisor changes the implied daily screening rate", () => {
  assert.equal(isBelowMinimum(20_000, "NCR", 365).impliedDaily, 657.53);
  assert.equal(isBelowMinimum(20_000, "NCR", 261).impliedDaily, 919.54);
});
