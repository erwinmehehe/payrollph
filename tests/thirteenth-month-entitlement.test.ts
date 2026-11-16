import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyBasicLine, computeThirteenthMonth, isThirteenthPayoutLine, sumBasicCentavos,
} from "../src/lib/thirteenth-month-entitlement";

/** Hand-derived fictional cases. Money in the tests is centavos unless a peso string is shown. */

// What dole-thirteenth-month-report.ts:37 and final-pay's payout reader do today, copied for comparison only.
const legacyEntitlementPesos = (basicPesos: number) =>
  Math.round(((Math.max(0, basicPesos) / 12) + Number.EPSILON) * 100) / 100;
const legacyGrantedPesos = (lines: number[]) => lines.reduce((sum, a) => sum + Math.max(0, a), 0);

test("entitlement is 1/12 of basic, centavo half-up", () => {
  // 120,000.00 / 12 = 10,000.00 exactly.
  assert.equal(computeThirteenthMonth({ basicCentavos: 12_000_000, payouts: {} }).entitlementCentavos, 1_000_000);
  // 100.02 -> 10,002 centavos / 12 = 833.5 -> half-up 834 -> 8.34.
  assert.equal(computeThirteenthMonth({ basicCentavos: 10_002, payouts: {} }).entitlementCentavos, 834);
  // 345,678.90 -> 34,567,890 / 12 = 2,880,657.5 (12 * 2,880,657 = 34,567,884, remainder 6) -> 2,880,658 -> 28,806.58.
  assert.equal(computeThirteenthMonth({ basicCentavos: 34_567_890, payouts: {} }).entitlementCentavos, 2_880_658);
  // 100.01 -> 10,001 / 12 = 833.42 -> 833 -> 8.33 (remainder 5 rounds down).
  assert.equal(computeThirteenthMonth({ basicCentavos: 10_001, payouts: {} }).entitlementCentavos, 833);
});

test("entitlement equals floor((c + 6) / 12) for every basic from 0 to 250,000 centavos", () => {
  for (let c = 0; c <= 250_000; c += 1) {
    const r = computeThirteenthMonth({ basicCentavos: c, payouts: {} });
    assert.equal(r.entitlementCentavos, Math.floor((c + 6) / 12), `c=${c}`);
    assert.deepEqual(r.blockers, [], `c=${c}`);
  }
});

test("KNOWN DIVERGENCE: the report's floating-point path is one centavo low where the exact path is right", () => {
  // Fails once dole-thirteenth-month-report.ts is rewired to this module; then update this test.
  assert.equal(legacyEntitlementPesos(100.02), 8.33);
  assert.equal(computeThirteenthMonth({ basicCentavos: 10_002, payouts: {} }).entitlementCentavos, 834);
  assert.equal(legacyEntitlementPesos(100.86), 8.4);
  assert.equal(computeThirteenthMonth({ basicCentavos: 10_086, payouts: {} }).entitlementCentavos, 841);
});

test("line classification: what is basic and what is not", () => {
  for (const code of ["BASIC", "LATE", "UT", "LEAVE-12"]) assert.equal(classifyBasicLine(code).included, true, code);
  for (const code of ["OT", "ND", "HOLIDAY", "HOLIDAY_UNWORKED", "OTPREM-3", "NDPREM-4", "LEAVE_CONV-9"]) {
    assert.deepEqual(classifyBasicLine(code), { included: false, kind: "EXCLUDED_PAY" }, code);
  }
  for (const code of ["SSS", "PHIC", "HDMF", "PAGIBIG", "WHT", "DM-1", "UNPAID_MANDATORY"]) {
    assert.deepEqual(classifyBasicLine(code), { included: false, kind: "NOT_PAY" }, code);
  }
  assert.equal(classifyBasicLine("basic").included, true, "case-insensitive");
  assert.equal(classifyBasicLine("MYSTERY").kind, "UNCLASSIFIED");
  assert.equal(classifyBasicLine(undefined).kind, "UNCLASSIFIED");
  assert.equal(isThirteenthPayoutLine({ code: "13TH-2026" }), true);
  assert.equal(isThirteenthPayoutLine({ label: "Thirteenth Month Pay" }), true);
  assert.equal(isThirteenthPayoutLine({ code: "BASIC", label: "Basic" }), false);
});

test("basic base: tardiness, undertime and paid leave count; OT, premiums, leave conversion do not", () => {
  const sum = sumBasicCentavos([
    { code: "BASIC", amount: "10000.00" },
    { code: "LATE", amount: -50 },
    { code: "UT", amount: "-25.50" },
    { code: "LEAVE-1", amount: "500.00" },
    { code: "OT", amount: "800.00" },
    { code: "HOLIDAY", amount: "300.00" },
    { code: "LEAVE_CONV-2", amount: "1000.00" },
    { code: "SSS", amount: "-450.00" },
  ]);
  // 10,000.00 - 50.00 - 25.50 + 500.00 = 10,424.50
  assert.equal(sum.basicCentavos, 1_042_450);
  assert.deepEqual(sum.excludedPay, { OT: 80_000, HOLIDAY: 30_000, "LEAVE_CONV-2": 100_000 });
  assert.deepEqual(sum.blockers, []);
  assert.deepEqual(sum.reviewFlags, []);
  // 1,042,450 / 12 = 86,870.83 -> 86,871 -> 868.71
  assert.equal(computeThirteenthMonth({ basicCentavos: sum.basicCentavos, payouts: {} }).entitlementCentavos, 86_871);
});

test("an unknown pay code is excluded AND flagged, never silently dropped or included", () => {
  const sum = sumBasicCentavos([{ code: "BASIC", amount: "1000.00" }, { code: "MYSTERY", amount: "500.00" }]);
  assert.equal(sum.basicCentavos, 100_000);
  assert.deepEqual(sum.excludedPay, { MYSTERY: 50_000 });
  assert.deepEqual(sum.reviewFlags, ["UNCLASSIFIED_LINE_EXCLUDED:MYSTERY"]);
});

test("unverifiable non-retro amounts are flagged, not treated as zero without a trace", () => {
  const sum = sumBasicCentavos([{ code: "BASIC", amount: "1000.00" }, { code: "BASIC", amount: "12.345" }]);
  assert.equal(sum.basicCentavos, 100_000);
  assert.deepEqual(sum.reviewFlags, ["AMOUNT_NOT_VERIFIABLE_SKIPPED:BASIC"]);
  assert.deepEqual(sum.blockers, ["LINE_AMOUNT_INVALID:BASIC"]);
});

test("retro basic counts only when the ORIGINAL cutoff is in the tax year; unknown year blocks", () => {
  const years = new Map<number, number | null>([[5, 2026], [6, 2025], [7, null]]);
  const retroSourceYear = (id: number) => years.get(id);
  const sum = sumBasicCentavos([
    { code: "BASIC", amount: "1000.00" },
    { code: "RETRO-5", amount: "200.00" },
    { code: "RETRO-6", amount: "300.00" },
    { code: "RETRO-7", amount: "400.00" },
    { code: "RETRO-9", amount: "50.00" },
    { code: "RETRO-8", amount: "abc" },
  ], { taxYear: 2026, retroSourceYear });
  assert.equal(sum.basicCentavos, 120_000, "1,000.00 + 200.00 only");
  assert.deepEqual(sum.excludedPay, { "RETRO-6": 30_000 });
  assert.deepEqual(sum.blockers, [
    "RETRO_SOURCE_YEAR_UNVERIFIED:RETRO-7", "RETRO_SOURCE_YEAR_UNVERIFIED:RETRO-9", "RETRO_AMOUNT_INVALID:RETRO-8",
  ]);
  // Without a tax year no retro line can be attributed.
  assert.deepEqual(sumBasicCentavos([{ code: "RETRO-5", amount: "200.00" }], { retroSourceYear }).blockers,
    ["RETRO_SOURCE_YEAR_UNVERIFIED:RETRO-5"]);
});

test("NEGATIVE LIABILITY: a reversal reduces what counts as granted (current code ignores it)", () => {
  // Basic 1,200,000.00 -> entitlement 100,000.00. Paid 5,000.00, then reversed -5,000.00 (e.g. voided payout).
  const r = computeThirteenthMonth({ basicCentavos: 120_000_000, payouts: { payroll: ["5000.00", "-5000.00"] } });
  assert.equal(r.entitlementCentavos, 10_000_000);
  assert.equal(r.grantedCentavos, 0);
  assert.equal(r.reversedCentavos, 500_000);
  assert.equal(r.stillDueCentavos, 10_000_000, "still due 100,000.00");
  // Current behaviour: per-line Math.max(0, amount) keeps the 5,000.00 and drops the reversal.
  assert.equal(legacyGrantedPesos([5000, -5000]), 5000);
  assert.equal(10_000_000 / 100 - legacyGrantedPesos([5000, -5000]), 95_000, "legacy would report 95,000.00 still due");
});

test("overpayment is reported and flagged, never recovered or credited", () => {
  // Basic 120,000.00 -> entitlement 10,000.00; paid 12,000.00.
  const r = computeThirteenthMonth({ basicCentavos: 12_000_000, payouts: { payroll: ["12000.00"] } });
  assert.equal(r.entitlementCentavos, 1_000_000);
  assert.equal(r.grantedCentavos, 1_200_000);
  assert.equal(r.stillDueCentavos, 0);
  assert.equal(r.overpaidCentavos, 200_000);
  assert.deepEqual(r.reviewFlags, ["OVERPAID_NOT_RECOVERED_NEEDS_POLICY"]);
});

test("sources are netted separately and floored at zero so one bad source cannot offset another", () => {
  const r = computeThirteenthMonth({
    basicCentavos: 12_000_000,
    payouts: { payroll: ["-100.00"], finalPay: ["500.00"] },
  });
  assert.equal(r.grantedCentavos, 50_000, "only the final-pay 500.00 counts; the lone reversal is floored at 0");
  assert.equal(r.reversedCentavos, 10_000);
  assert.deepEqual(r.reviewFlags, ["REVERSALS_EXCEED_PAYOUTS_FLOORED_AT_ZERO:payroll"]);
  assert.equal(r.stillDueCentavos, 950_000);
});

test("payroll, historical and final-pay payouts add up", () => {
  // Entitlement 10,000.00; paid 4,000.00 + 1,000.50 + 2,500.00 = 7,500.50; still due 2,499.50.
  const r = computeThirteenthMonth({
    basicCentavos: 12_000_000,
    payouts: { payroll: ["4000.00"], historical: [1000.5], finalPay: ["2500.00"] },
  });
  assert.equal(r.grantedCentavos, 750_050);
  assert.equal(r.stillDueCentavos, 249_950);
  assert.equal(r.overpaidCentavos, 0);
  assert.deepEqual(r.reviewFlags, []);
});

test("a net-negative basic base floors the entitlement at zero and is flagged", () => {
  const sum = sumBasicCentavos([{ code: "LATE", amount: "-500.00" }]);
  assert.equal(sum.basicCentavos, -50_000);
  const r = computeThirteenthMonth({ basicCentavos: sum.basicCentavos, payouts: {} });
  assert.equal(r.entitlementCentavos, 0);
  assert.deepEqual(r.reviewFlags, ["BASIC_NET_NEGATIVE_FLOORED_AT_ZERO"]);
});

test("invalid inputs fail closed with blockers instead of guessing", () => {
  const badPayout = computeThirteenthMonth({ basicCentavos: 12_000_000, payouts: { payroll: ["12.345", Number.NaN] } });
  assert.deepEqual(badPayout.blockers, ["PAYOUT_AMOUNT_INVALID:payroll", "PAYOUT_AMOUNT_INVALID:payroll"]);
  assert.equal(badPayout.grantedCentavos, 0);
  assert.equal(badPayout.stillDueCentavos, 0, "blockers must prevent a usable partial balance");
  assert.equal(badPayout.entitlementCentavos, 0);

  const badBasic = computeThirteenthMonth({ basicCentavos: 100.5, payouts: {} });
  assert.deepEqual(badBasic.blockers, ["BASIC_NOT_INTEGER_CENTAVOS"]);
  assert.equal(badBasic.entitlementCentavos, 0);

  const tooLarge = computeThirteenthMonth({ basicCentavos: 100_000_000_000_001, payouts: {} });
  assert.equal(tooLarge.entitlementCentavos, 0);
  assert.equal(tooLarge.blockers.length, 1, "beyond the safe centavo bound it blocks instead of rounding");
});


test("missing BASIC amounts block rather than silently reducing earned salary", () => {
  const sum = sumBasicCentavos([{ code: "BASIC", amount: "1000.00" }, { code: "BASIC" }]);
  assert.deepEqual(sum.blockers, ["LINE_AMOUNT_INVALID:BASIC"]);
  assert.equal(sum.basicCentavos, 100_000, "a blocked sum is diagnostic only");
  assert.deepEqual(sum.reviewFlags, ["AMOUNT_NOT_VERIFIABLE_SKIPPED:BASIC"]);
});

test("retro adjustment ids must be safe integers before source-year lookup", () => {
  let called = false;
  const sum = sumBasicCentavos([{ code: "RETRO-9007199254740992", amount: "10.00" }],
    { taxYear: 2026, retroSourceYear: () => { called = true; return 2026; } });
  assert.equal(called, false);
  assert.deepEqual(sum.blockers, ["RETRO_SOURCE_YEAR_UNVERIFIED:RETRO-9007199254740992"]);
});

test("basic and excluded-pay accumulators block on unsafe centavo totals", () => {
  const large = "50000000000000.00"; // 5 quadrillion cents per verified line, under Number.MAX_SAFE_INTEGER
  const basic = sumBasicCentavos([{ code: "BASIC", amount: large }, { code: "BASIC", amount: large }]);
  assert.deepEqual(basic.blockers, ["BASIC_TOTAL_UNSAFE:BASIC"]);
  const excluded = sumBasicCentavos([{ code: "OT", amount: large }, { code: "OT", amount: large }]);
  assert.deepEqual(excluded.blockers, ["EXCLUDED_PAY_TOTAL_UNSAFE:OT"]);
});

test("unsafe payout, reversal and across-source totals never return usable balances", () => {
  const large = "50000000000000.00";
  const sameSource = computeThirteenthMonth({
    basicCentavos: 12_000_000, payouts: { payroll: [large, large] },
  });
  assert.ok(sameSource.blockers.includes("PAYOUT_TOTAL_UNSAFE:payroll"));
  assert.equal(sameSource.grantedCentavos, 0);
  assert.equal(sameSource.stillDueCentavos, 0);

  const acrossSources = computeThirteenthMonth({
    basicCentavos: 12_000_000, payouts: { payroll: [large], historical: [large] },
  });
  assert.ok(acrossSources.blockers.includes("GRANTED_TOTAL_UNSAFE"));
  assert.equal(acrossSources.grantedCentavos, 0);

  const reversals = computeThirteenthMonth({
    basicCentavos: 12_000_000, payouts: { payroll: ["-50000000000000.00", "-50000000000000.00"] },
  });
  assert.ok(reversals.blockers.includes("REVERSAL_TOTAL_UNSAFE:payroll"));
  assert.equal(reversals.reversedCentavos, 0);
});

test("centavo rounding stays exact up to the supported one-trillion-peso basic boundary", () => {
  for (const basicCentavos of [
    0, 1, 5, 6, 11, 12, 13,
    99_999_999_999_993, 99_999_999_999_994, 99_999_999_999_995,
    99_999_999_999_999, 100_000_000_000_000,
  ]) {
    const got = computeThirteenthMonth({ basicCentavos, payouts: {} });
    assert.deepEqual(got.blockers, [], `c=${basicCentavos}`);
    assert.equal(got.entitlementCentavos, Number((BigInt(basicCentavos) + 6n) / 12n),
      `c=${basicCentavos}`);
  }
  const beyond = computeThirteenthMonth({ basicCentavos: 100_000_000_000_001, payouts: {} });
  assert.deepEqual(beyond.blockers, ["THIRTEENTH_BASIC_CENTAVOS_INVALID"]);
  assert.equal(beyond.entitlementCentavos, 0);
});

test("end to end: lines -> base -> entitlement -> shortfall", () => {
  // Twelve months of 20,000.00 basic with 1,000.00 total lateness and one 2,000.00 retro from LAST year, plus OT.
  const lines = [
    { code: "BASIC", amount: "240000.00" },
    { code: "LATE", amount: "-1000.00" },
    { code: "OT", amount: "6000.00" },
    { code: "RETRO-1", amount: "2000.00" },
    { code: "13TH-2026", amount: "10000.00" },
  ];
  const base = sumBasicCentavos(lines, { taxYear: 2026, retroSourceYear: (id) => (id === 1 ? 2025 : undefined) });
  assert.equal(base.basicCentavos, 23_900_000, "240,000.00 - 1,000.00; OT, last-year retro and the payout are out");
  const payout = lines.filter(isThirteenthPayoutLine).map((l) => l.amount);
  const r = computeThirteenthMonth({ basicCentavos: base.basicCentavos, payouts: { payroll: payout } });
  // 239,000.00 / 12 = 19,916.666... -> 19,916.67. Paid 10,000.00. Still due 9,916.67.
  assert.equal(r.entitlementCentavos, 1_991_667);
  assert.equal(r.grantedCentavos, 1_000_000);
  assert.equal(r.stillDueCentavos, 991_667);
});
