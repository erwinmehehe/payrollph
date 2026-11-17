import assert from "node:assert/strict";
import test from "node:test";
import { importedBenefitPrior } from "../src/lib/imported-benefit-prior";

const row = (employeeId: number, payDate: string, deMinimisBreakdown: unknown, thirteenthMonth: number | string | null = 0) =>
  ({ employeeId, payDate, thirteenthMonth, deMinimisBreakdown });

// Hand-derived: uniformClothing ceiling 8,000 a year; riceSubsidy ceiling 2,500 a month (DE_MINIMIS_2026).
test("six imported months of 6,000 uniform allowance: 36,000 paid, 28,000 over the 8,000 ceiling joins the pool", () => {
  const rows = [1, 2, 3, 4, 5, 6].map((m) => row(1, `2026-0${m}-28`, { uniformClothing: 6000 }));
  const { known, unverifiable } = importedBenefitPrior(rows, "2026-07-15");
  assert.equal(unverifiable.size, 0);
  assert.deepEqual(known.get(1), { deMinimisPaid: { uniformClothing: 36000 }, benefitPool90k: 28000 });
});

test("a monthly ceiling is applied per month and only the current month counts as already paid", () => {
  // Rice 3,000 in each of Jan-Jun: each month 500 over 2,500 -> pool 6 x 500 = 3,000; nothing paid in July yet.
  const rows = [1, 2, 3, 4, 5, 6].map((m) => row(1, `2026-0${m}-28`, { riceSubsidy: 3000 }));
  assert.deepEqual(importedBenefitPrior(rows, "2026-07-15").known.get(1), { deMinimisPaid: {}, benefitPool90k: 3000 });
  // A cutoff paid on 2026-06-30 is inside June: June's 3,000 is already paid in that statutory month.
  assert.deepEqual(importedBenefitPrior(rows, "2026-06-30").known.get(1)?.deMinimisPaid, { riceSubsidy: 3000 });
});

test("an imported 13th month already paid uses the shared 90,000 pool", () => {
  const rows = [row(1, "2026-03-31", {}, "1250.50"), row(1, "2026-04-30", {}, 100)];
  assert.deepEqual(importedBenefitPrior(rows, "2026-07-15").known.get(1), { deMinimisPaid: {}, benefitPool90k: 1350.5 });
});

test("a missing, unreadable or unprovable breakdown makes the worker unverifiable and nothing is assumed", () => {
  const cases: Array<[string, unknown]> = [
    ["no breakdown", null],
    ["array", []],
    ["negative amount", { uniformClothing: -1 }],
    ["unknown category", { madeUp: 100 }],
    ["category without a peso ceiling", { monetizedVacationLeaveDays: 2 }],
  ];
  for (const [label, breakdown] of cases) {
    const { known, unverifiable } = importedBenefitPrior([row(1, "2026-01-31", { uniformClothing: 100 }), row(1, "2026-02-28", breakdown)], "2026-07-15");
    assert.ok(unverifiable.has(1), label);
    assert.equal(known.has(1), false, label);
  }
});

test("workers are independent: one unverifiable worker does not hide another's known consumption", () => {
  const { known, unverifiable } = importedBenefitPrior([
    row(1, "2026-01-31", { uniformClothing: 9000 }),
    row(2, "2026-01-31", null),
  ], "2026-07-15");
  assert.deepEqual([...unverifiable], [2]);
  assert.deepEqual(known.get(1), { deMinimisPaid: { uniformClothing: 9000 }, benefitPool90k: 1000 });
});

test("an empty breakdown is a known zero, not an unknown", () => {
  const { known, unverifiable } = importedBenefitPrior([row(1, "2026-01-31", {})], "2026-07-15");
  assert.equal(unverifiable.size, 0);
  assert.deepEqual(known.get(1), { deMinimisPaid: {}, benefitPool90k: 0 });
});
