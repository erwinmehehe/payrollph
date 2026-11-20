import assert from "node:assert/strict";
import test from "node:test";
import {
  HISTORICAL_WAGE_ORDERS, RBVI29_EFFECTIVE_ON, RBVI30_EFFECTIVE_ON,
  RBVI30_SOURCE_URL, REGION_VI_WAGE_TIERS, WAGE_ORDERS,
  isBelowMinimum, wageOrderFor, wageScreenForWorkPeriod,
} from "../src/lib/wage-orders";

// Official NWPC 2026-11-11 news + Region VI Wage Order VI-(WESTERN VISAYAS)-30,
// issued 2026-10-21, published 2026-11-04, effective 2026-11-20.
// https://nwpc.dole.gov.ph/region-vi/
// https://nwpc.dole.gov.ph/western-visayas-soccsksargen-private-sector-workers-kasambahays-to-receive-wage-increases/
// An agency category rate is NOT approval to classify a real employer, grant
// an exemption, change MWE status, or reprice previous payroll history.

test("VI-30 current high-tier advisory is dated November 20, historical VI-29 stays available", () => {
  assert.equal(RBVI29_EFFECTIVE_ON, "2025-11-19");
  assert.equal(RBVI30_EFFECTIVE_ON, "2026-11-20");
  assert.match(RBVI30_SOURCE_URL, /^https:\/\/nwpc\.dole\.gov\.ph\//);
  assert.equal(WAGE_ORDERS.filter(o => o.region === "VI").length, 1);
  const current = wageOrderFor("VI");
  assert.deepEqual({ rate: current.dailyRate, order: current.wageOrder, effectivity: current.effectiveOn },
    { rate: 590, order: "WO-RBVI-30", effectivity: "2026-11-20" });
  const history = HISTORICAL_WAGE_ORDERS.find(o => o.region === "VI");
  assert.ok(history);
  assert.equal(history.dailyRate, 550);
  assert.equal(history.wageOrder, "WO-RBVI-29");
  assert.equal(history.effectiveOn, "2025-11-19");
});

test("VI-30 work-date transition cannot back-apply to November 19 or older payroll", () => {
  const yesterday = wageOrderFor("VI", "2026-11-19");
  assert.equal(yesterday.wageOrder, "WO-RBVI-29");
  assert.equal(yesterday.dailyRate, 550);
  const today = wageOrderFor("VI", "2026-11-20");
  assert.equal(today.wageOrder, "WO-RBVI-30");
  assert.equal(today.dailyRate, 590);
  assert.equal(wageOrderFor("VI", "2026-11-21").dailyRate, 590);
  assert.equal(wageOrderFor("VI", "2026-07-15").dailyRate, 550);
  assert.throws(() => wageOrderFor("VI", "2025-11-18"), /No verified wage-order history/);
  assert.throws(() => wageOrderFor("VI", "2026-11-31"), /Invalid wage screening calendar date/);
});

test("verified Region VI industry and size classes have distinct effective-dated daily floors", () => {
  assert.deepEqual(REGION_VI_WAGE_TIERS.map(t => [t.wageClass, t.oldDailyRate, t.newDailyRate]), [
    ["nonagri_gt10", 550, 590],
    ["nonagri_le10", 525, 565],
    ["agriculture", 520, 565],
  ]);
  for (const tier of REGION_VI_WAGE_TIERS) {
    assert.equal(wageOrderFor("VI", "2026-11-19", tier.wageClass).dailyRate, tier.oldDailyRate);
    assert.equal(wageOrderFor("VI", "2026-11-20", tier.wageClass).dailyRate, tier.newDailyRate);
    assert.equal(wageOrderFor("VI", "2026-11-20", tier.wageClass).wageOrder, "WO-RBVI-30");
    assert.equal(wageOrderFor("VI", undefined, tier.wageClass).dailyRate, tier.newDailyRate);
  }
});

test("unknown category uses highest tier as review warning; small/agri evidence avoids false low wage flag", () => {
  const monthly = 575 * 22;
  assert.equal(isBelowMinimum(monthly, "VI", 22, "2026-11-19").below, false);
  assert.equal(isBelowMinimum(monthly, "VI", 22, "2026-11-20").below, true,
    "Unknown employer class gets a review warning, not a salary change");
  assert.equal(isBelowMinimum(monthly, "VI", 22, "2026-11-20", "nonagri_gt10").below, true);
  assert.equal(isBelowMinimum(monthly, "VI", 22, "2026-11-20", "nonagri_le10").below, false);
  assert.equal(isBelowMinimum(monthly, "VI", 22, "2026-11-20", "agriculture").below, false);
  assert.equal(wageOrderFor("NCR").dailyRate, 755, "unrelated region unchanged");
});

test("crossing work period remains advisory and returns original source order; pay date does not rewrite work", () => {
  const crossing = wageScreenForWorkPeriod(575 * 22, "VI", 22, "2026-11-19", "2026-11-20");
  assert.equal(crossing.startOrder.dailyRate, 550);
  assert.equal(crossing.order.dailyRate, 590);
  assert.equal(crossing.effectiveDateChange, true);
  assert.equal(crossing.below, true);
  const earlier = wageScreenForWorkPeriod(575 * 22, "VI", 22, "2026-11-16", "2026-11-19");
  assert.equal(earlier.order.dailyRate, 550);
  assert.equal(earlier.effectiveDateChange, false);
  assert.equal(earlier.below, false);
  const small = wageScreenForWorkPeriod(575 * 22, "VI", 22, "2026-11-19", "2026-11-20", "nonagri_le10");
  assert.equal(small.startOrder.dailyRate, 525);
  assert.equal(small.order.dailyRate, 565);
  assert.equal(small.effectiveDateChange, true);
  assert.equal(small.below, false);
});

test("wrong region/class and early unsupported dates fail closed instead of inferring category", () => {
  assert.throws(() => wageOrderFor("VI", "2026-11-20", "A"), /Invalid Region VI wage class/);
  assert.throws(() => wageOrderFor("VII", "2026-11-20", "nonagri_le10"), /Invalid Region VII wage class/);
  assert.throws(() => wageOrderFor("NCR", "2026-11-20", "nonagri_le10"), /region/i);
  assert.throws(() => wageOrderFor("VI", "2025-01-01", "agriculture"), /No verified wage-order history/);
  assert.throws(() => wageScreenForWorkPeriod(590 * 22, "VI", 22, "2026-11-21", "2026-11-19"),
    /starts after it ends/);
});
