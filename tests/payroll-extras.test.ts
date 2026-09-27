import assert from "node:assert/strict";
import test from "node:test";
import { computeAccrual, computeBalance, carryOverDays } from "../src/lib/leave-accrual";
import { computeEwa, EWA_ADVANCE_RATE } from "../src/lib/ewa";

test("leave accrues monthly at annual/12", () => {
  // 12 days/year => 1 day/month. Hired 1 Jan, by 30 Jun = 6 months elapsed (Jun in progress => 30/30).
  const accrued = computeAccrual(12, "2026-01-01", "2026-06-30");
  assert.equal(accrued, 6);
});

test("first month is prorated from the start date", () => {
  // Hired 15 Jan: Jan partial = 17/31 of a month; 12 days/yr => 1 per month.
  const firstMonth = computeAccrual(12, "2026-01-15", "2026-01-31");
  assert.ok(firstMonth > 0 && firstMonth < 1, `expected partial, got ${firstMonth}`);
});

test("no accrual before the start date", () => {
  assert.equal(computeAccrual(12, "2026-03-01", "2026-02-01"), 0);
});

test("balance subtracts approved and pending days and never goes negative", () => {
  const balance = computeBalance({
    policy: { leaveType: "Annual leave", annualDays: 12 },
    startDate: "2026-01-01",
    asOf: "2026-06-30",
    opening: 0,
    used: 3,
    pending: 1,
  });
  assert.equal(balance.available, 2); // 6 accrued - 3 used - 1 pending
});

test("balance respects the policy maximum", () => {
  const balance = computeBalance({
    policy: { leaveType: "Annual leave", annualDays: 12, maxBalance: 5 },
    startDate: "2026-01-01",
    asOf: "2026-12-31",
  });
  assert.equal(balance.capped, true);
  assert.equal(balance.available, 5);
});

test("carry-over is capped by policy", () => {
  assert.equal(carryOverDays(10, 5), 5);
  assert.equal(carryOverDays(3, 5), 3);
  assert.equal(carryOverDays(10, null), 10);
});

test("EWA accrues net of statutory deductions", () => {
  const result = computeEwa({ monthlyBasic: 30000, daysWorked: 10 });
  assert.ok(result.accruedGross > 0);
  assert.ok(result.statutoryDeductions > 0);
  assert.ok(result.accruedNet < result.accruedGross);
});

test("EWA caps the advance at 50% of accrued net", () => {
  const result = computeEwa({ monthlyBasic: 30000, daysWorked: 10 });
  assert.ok(Math.abs(result.maxAdvance - result.accruedNet * EWA_ADVANCE_RATE) < 0.01);
});

test("EWA rejects a request above the cap with a reason", () => {
  const small = computeEwa({ monthlyBasic: 30000, daysWorked: 10 });
  const result = computeEwa({ monthlyBasic: 30000, daysWorked: 10, requested: small.maxAdvance + 1000 });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.some((r) => r.includes("cap")));
});

test("EWA rejects inactive employees and zero earned days", () => {
  assert.equal(computeEwa({ monthlyBasic: 30000, daysWorked: 10, status: "Separating" }).eligible, false);
  assert.equal(computeEwa({ monthlyBasic: 30000, daysWorked: 0 }).eligible, false);
});

test("existing advances reduce the remaining advanceable amount", () => {
  const base = computeEwa({ monthlyBasic: 30000, daysWorked: 10 });
  const withAdvance = computeEwa({ monthlyBasic: 30000, daysWorked: 10, existingAdvances: base.maxAdvance });
  assert.equal(withAdvance.maxAdvance, 0);
});
