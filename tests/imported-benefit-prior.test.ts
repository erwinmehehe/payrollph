import assert from "node:assert/strict";
import test from "node:test";
import { importedBenefitPrior } from "../src/lib/imported-benefit-prior";

const row = (employeeId: number, payDate: string, deMinimisBreakdown: unknown, thirteenthMonth: number | string | null = 0) =>
  ({ employeeId, payDate, grossPay: 100000, thirteenthMonth, deMinimisBreakdown });

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
    ["unsupported zero category", { madeUp: 0 }],
    ["unsupported zero day-based category", { monetizedVacationLeaveDays: 0 }],
    ["blank money", { uniformClothing: "" }],
    ["fractional centavo", { uniformClothing: 1.001 }],
    ["null reported amount", { uniformClothing: null }],
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

test("invalid 13th-month evidence or de minimis exceeding gross never clears review", () => {
  const badThirteenth: Array<number | string | null> = [-1, "Infinity", "", null, 1.001];
  for (const value of badThirteenth) {
    const result = importedBenefitPrior([row(1, "2026-04-30", { uniformClothing: 6000 }, value)], "2026-07-15");
    assert.equal(result.known.size, 0, "invalid 13th-month: " + String(value));
    assert.ok(result.unverifiable.has(1));
  }
  const excessive = { ...row(2, "2026-06-30", { uniformClothing: 120 }), grossPay: 100 };
  const result = importedBenefitPrior([excessive], "2026-07-15");
  assert.equal(result.known.has(2), false);
  assert.ok(result.unverifiable.has(2));
});

test("a prior-provider row cannot claim more combined de minimis and 13th-month than reported gross", () => {
  const impossible = { ...row(4, "2026-06-30", { uniformClothing: 7000 }, "5000"), grossPay: "10000.00" };
  // Both categories individually fit the 10,000 gross, but their 12,000
  // combined total does not. Otherwise the engine could tax a fabricated pool.
  const bad = importedBenefitPrior([impossible], "2026-07-15");
  assert.ok(bad.unverifiable.has(4));
  assert.equal(bad.known.has(4), false);

  const boundary = { ...impossible, thirteenthMonth: "3000.00" };
  const good = importedBenefitPrior([boundary], "2026-07-15");
  assert.equal(good.unverifiable.size, 0);
  assert.deepEqual(good.known.get(4), { deMinimisPaid: { uniformClothing: 7000 }, benefitPool90k: 3000 });
});

test("a verified category and 13th-month floor is not a certificate of all previous-provider 90k benefits", () => {
  // No imported field records all other bonuses/benefits. The engine must
  // retain the separate pool-evidence review hold even when this floor is known.
  const result = importedBenefitPrior([row(3, "2026-06-30", { uniformClothing: 10000 }, "500")], "2026-07-15");
  assert.deepEqual(result.known.get(3), { deMinimisPaid: { uniformClothing: 10000 }, benefitPool90k: 2500 });
});
