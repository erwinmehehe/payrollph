import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildEwtQuarterSchedule, ewtQuarterPeriod, type EwtPayee, type EwtPayment } from "../src/lib/contractor-ewt-quarter";

// Fictional payees and ATC codes. Expected figures are derived by hand from gross x rate / 100.
const payees: EwtPayee[] = [
  { id: 1, name: "Fictional Design Studio", tin: "123456789", country: "PH" },
  { id: 2, name: "Fictional Lessor", tin: "987-654-321", country: null },
];
const pay = (id: number, contractorId: number, paymentDate: string, gross: number, atc: string, rate: number, withheld: number): EwtPayment =>
  ({ id, contractorId, paymentDate, grossAmountPhp: gross.toFixed(2), withholdingAtc: atc, withholdingRate: rate.toFixed(3), withholdingAmount: withheld.toFixed(2) });
// Payee 1: WI010 at 10% in July 50,000 (5,000), August 30,000 (3,000), September 20,000 (2,000); WI011 at 15% in August 10,000 (1,500).
// Payee 2: WC100 at 5% in July 40,000 (2,000) and September 60,000 (3,000).
const q3: EwtPayment[] = [
  pay(1, 1, "2026-07-10", 50000, "WI010", 10, 5000), pay(2, 1, "2026-08-20", 30000, "WI010", 10, 3000),
  pay(3, 1, "2026-09-05", 20000, "WI010", 10, 2000), pay(4, 1, "2026-08-01", 10000, "WI011", 15, 1500),
  pay(5, 2, "2026-07-01", 40000, "WC100", 5, 2000), pay(6, 2, "2026-09-30", 60000, "WC100", 5, 3000),
];

test("the quarter is three calendar months", () => {
  assert.deepEqual(ewtQuarterPeriod("2026-Q3"), { start: "2026-07-01", end: "2026-09-30", months: ["2026-07", "2026-08", "2026-09"] });
  assert.deepEqual(ewtQuarterPeriod("2028-Q1").end, "2028-03-31");
  assert.throws(() => ewtQuarterPeriod("2026-Q5"));
});

test("each payee gets its income by ATC and by month of the quarter, as a 2307 needs", () => {
  const schedule = buildEwtQuarterSchedule({ quarter: "2026-Q3", payments: q3, payees });
  assert.deepEqual(schedule.issues, []);
  assert.equal(schedule.reviewable, true);
  assert.equal(schedule.filingReady, false, "never a filing or a certificate");
  assert.deepEqual(schedule.payees, [
    { contractorId: 1, name: "Fictional Design Studio", tin: "123456789", totalIncome: "110000.00", totalTaxWithheld: "11500.00", lines: [
      { atc: "WI010", ratePercent: "10.000", months: ["50000.00", "30000.00", "20000.00"], totalIncome: "100000.00", taxWithheld: "10000.00", paymentIds: [1, 2, 3] },
      { atc: "WI011", ratePercent: "15.000", months: ["0.00", "10000.00", "0.00"], totalIncome: "10000.00", taxWithheld: "1500.00", paymentIds: [4] },
    ] },
    { contractorId: 2, name: "Fictional Lessor", tin: "987654321", totalIncome: "100000.00", totalTaxWithheld: "5000.00", lines: [
      { atc: "WC100", ratePercent: "5.000", months: ["40000.00", "0.00", "60000.00"], totalIncome: "100000.00", taxWithheld: "5000.00", paymentIds: [5, 6] },
    ] },
  ]);
});

test("the per-ATC 1601-EQ totals equal the payee schedule", () => {
  const schedule = buildEwtQuarterSchedule({ quarter: "2026-Q3", payments: q3, payees });
  assert.deepEqual(schedule.byAtc, [
    { atc: "WC100", ratePercent: "5.000", totalIncome: "100000.00", taxWithheld: "5000.00", payees: 1 },
    { atc: "WI010", ratePercent: "10.000", totalIncome: "100000.00", taxWithheld: "10000.00", payees: 1 },
    { atc: "WI011", ratePercent: "15.000", totalIncome: "10000.00", taxWithheld: "1500.00", payees: 1 },
  ]);
  assert.deepEqual(schedule.totals, { totalIncome: "210000.00", taxWithheld: "16500.00", payments: 6 });
});

test("the withholding check rounds exactly like the payments API", () => {
  // 33,333.33 x 1.5% = 499.99995, which rounds to 500.00.
  const ok = buildEwtQuarterSchedule({ quarter: "2026-Q3", payees, payments: [pay(9, 1, "2026-07-15", 33333.33, "WI010", 1.5, 500)] });
  assert.deepEqual(ok.issues, []);
  const off = buildEwtQuarterSchedule({ quarter: "2026-Q3", payees, payments: [pay(9, 1, "2026-07-15", 50000, "WI010", 10, 5000.01)] });
  assert.equal(off.reviewable, false);
  assert.match(off.issues.join(" "), /WITHHOLDING_MISMATCH: payment #9 withheld 5000\.01 but 50000\.00 at 10\.000% is 5000\.00/);
  assert.equal(off.totals.taxWithheld, "5000.01", "the recorded amount is reported, not silently corrected");
});

test("a rate change inside the quarter keeps separate lines for the same ATC", () => {
  const schedule = buildEwtQuarterSchedule({ quarter: "2026-Q3", payees, payments: [pay(1, 1, "2026-07-10", 10000, "WI010", 5, 500), pay(2, 1, "2026-09-10", 10000, "WI010", 10, 1000)] });
  assert.deepEqual(schedule.payees[0].lines.map((line) => [line.atc, line.ratePercent, line.taxWithheld]), [["WI010", "5.000", "500.00"], ["WI010", "10.000", "1000.00"]]);
});

test("each problem is reported and makes the schedule unreviewable", () => {
  const cases: Array<[string, EwtPayment[], EwtPayee[], RegExp]> = [
    ["outside the quarter", [pay(1, 1, "2026-10-01", 1000, "WI010", 10, 100)], payees, /OUTSIDE_QUARTER: payment #1/],
    ["non-centavo amount", [pay(1, 1, "2026-07-01", 0, "WI010", 10, 0), { ...pay(2, 1, "2026-07-01", 0, "WI010", 10, 0), grossAmountPhp: "1.005" }], payees, /INVALID_AMOUNT: payment #2/],
    ["rate out of range", [pay(1, 1, "2026-07-01", 1000, "WI010", 120, 1200)], payees, /INVALID_RATE: payment #1/],
    ["no ATC", [pay(1, 1, "2026-07-01", 1000, " ", 10, 100)], payees, /MISSING_ATC: payment #1/],
    ["unknown payee", [pay(1, 99, "2026-07-01", 1000, "WI010", 10, 100)], payees, /UNKNOWN_PAYEE: payment #1/],
    ["no TIN", [pay(1, 3, "2026-07-01", 1000, "WI010", 10, 100)], [{ id: 3, name: "No TIN", tin: null, country: "PH" }], /MISSING_TIN: payee #3/],
    ["short TIN", [pay(1, 3, "2026-07-01", 1000, "WI010", 10, 100)], [{ id: 3, name: "Short", tin: "12345", country: "PH" }], /MISSING_TIN: payee #3/],
    ["non-resident", [pay(1, 4, "2026-07-01", 1000, "WI010", 10, 100)], [{ id: 4, name: "Overseas", tin: "111222333", country: "US" }], /NON_RESIDENT_REVIEW: payee #4/],
  ];
  for (const [name, payments, people, expected] of cases) {
    const schedule = buildEwtQuarterSchedule({ quarter: "2026-Q3", payments, payees: people });
    assert.equal(schedule.reviewable, false, name);
    assert.match(schedule.issues.join(" "), expected, name);
  }
});

test("a payee without a valid TIN keeps its figures but has no TIN", () => {
  const schedule = buildEwtQuarterSchedule({ quarter: "2026-Q3", payments: [pay(1, 3, "2026-07-01", 1000, "WI010", 10, 100)], payees: [{ id: 3, name: "No TIN", tin: "", country: "PH" }] });
  assert.equal(schedule.payees[0].tin, null);
  assert.equal(schedule.payees[0].totalTaxWithheld, "100.00");
});

test("the module is pure and wired into no route", () => {
  const source = readFileSync("src/lib/contractor-ewt-quarter.ts", "utf8");
  assert.ok(!/from "@\/db|from "\.\.\/db|writeFile|fetch\(|process\.env/.test(source));
  assert.match(source, /does NOT validate ATCs or rates/);
});
