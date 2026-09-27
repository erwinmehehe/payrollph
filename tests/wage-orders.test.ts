import assert from "node:assert/strict";
import test from "node:test";
import { holidayMultiplier } from "../src/lib/payroll-rules";
import { holidayOn, isBelowMinimum, wageOrderFor } from "../src/lib/wage-orders";

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

test("demo special non-working day on 2026-03-11 is recognized", () => {
  const holiday = holidayOn("2026-03-11");
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
