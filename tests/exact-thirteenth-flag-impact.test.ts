import assert from "node:assert/strict";
import test from "node:test";
import { computeFinalPay } from "../src/lib/final-pay";
import { computeThirteenthMonthPay } from "../src/lib/ph-compliance";
import { buildDoleThirteenthMonthReport } from "../src/lib/dole-thirteenth-month-report";

/**
 * What flipping EXACT_THIRTEENTH_CENTAVOS_ENABLED changes. Pure functions only, fictional amounts.
 * The flag is OFF by default. Nothing here enables it anywhere; each test restores the variable.
 */

const FLAG = "EXACT_THIRTEENTH_CENTAVOS_ENABLED";
function withFlag<T>(value: "true" | undefined, run: () => T): T {
  const before = process.env[FLAG];
  try {
    if (value === undefined) delete process.env[FLAG]; else process.env[FLAG] = value;
    return run();
  } finally {
    if (before === undefined) delete process.env[FLAG]; else process.env[FLAG] = before;
  }
}

/** Independent references: legacy float formula, and exact integer-centavo half-up. */
const legacy = (basicPesos: number) => Math.round(((basicPesos / 12) + Number.EPSILON) * 100) / 100;
const exact = (centavos: number) => Math.floor((centavos + 6) / 12) / 100;

function finalPayFor(basicPesos: number, paid = 0) {
  return computeFinalPay({
    releasedBasicYtd: basicPesos, historicalBasicYtd: 0, unpaidBasicSalary: 0,
    thirteenthPaidYtd: paid, grossCompensationYtd: basicPesos, statutoryContributionsYtd: 0,
    taxWithheldYtd: 0, mwe: false, leaveMonetizationPay: 0, separationPay: 0, retirementPay: 0,
    otherBenefits: 0, loanDeductions: 0,
  });
}

test("flag OFF keeps the legacy float rounding, flag ON uses exact centavo half-up (final pay)", () => {
  assert.equal(withFlag(undefined, () => finalPayFor(100.02).thirteenthEntitlement), 8.33);
  assert.equal(withFlag("true", () => finalPayFor(100.02).thirteenthEntitlement), 8.34);
  // 100.86 -> 10,086 / 12 = 840.5 -> half-up 841. Float path gives 8.40.
  assert.equal(withFlag(undefined, () => finalPayFor(100.86).thirteenthEntitlement), 8.4);
  assert.equal(withFlag("true", () => finalPayFor(100.86).thirteenthEntitlement), 8.41);
  // Whole amounts agree in both modes.
  for (const basic of [120000, 240000.0, 100.08]) {
    assert.equal(
      withFlag(undefined, () => finalPayFor(basic).thirteenthEntitlement),
      withFlag("true", () => finalPayFor(basic).thirteenthEntitlement),
      String(basic),
    );
  }
});

test("flipping the flag moves final-pay 13th entitlement by 0 or +0.01, never down, over 100.00..1,000.00", () => {
  let differing = 0;
  for (let c = 10_000; c <= 100_000; c += 1) {
    const basic = c / 100;
    const off = withFlag(undefined, () => finalPayFor(basic).thirteenthEntitlement);
    const on = withFlag("true", () => finalPayFor(basic).thirteenthEntitlement);
    assert.equal(off, legacy(basic), `off c=${c}`);
    assert.equal(on, exact(c), `on c=${c}`);
    const delta = Math.round((on - off) * 100);
    assert.ok(delta === 0 || delta === 1, `c=${c} delta=${delta}`);
    if (delta === 1) differing += 1;
  }
  assert.ok(differing > 0, "the flag must change at least some amounts");
  // Independently recounted with the bare formulas (no computeFinalPay): 831 of 90,001 amounts.
  assert.equal(differing, 831);
});

test("the standalone 13th-month helper flips the same way", () => {
  assert.equal(withFlag(undefined, () => computeThirteenthMonthPay(100.02)), 8.33);
  assert.equal(withFlag("true", () => computeThirteenthMonthPay(100.02)), 8.34);
});

test("with the flag OFF the DOLE screening can list a one-centavo shortfall that final pay would never pay", () => {
  // Basic 100.02, granted 8.33 (the OFF-mode entitlement). DOLE screening is exact regardless of the flag.
  const dole = buildDoleThirteenthMonthReport({
    taxYear: 2026, establishmentName: "Fictional Co", profile: null,
    workers: [{ employeeId: 1, employeeNo: "E1", employeeName: "A", basicSalaryEarned: 100.02,
      payrollThirteenthPaid: 8.33, historicalThirteenthPaid: 0, finalPayThirteenthPaid: 0, basicSalaryComplete: true }],
  });
  assert.equal(dole.reviewRows.length, 1);
  assert.equal(dole.reviewRows[0]?.screeningShortfall, 0.01);
  const dueOff = withFlag(undefined, () => finalPayFor(100.02, 8.33).thirteenthDue);
  const dueOn = withFlag("true", () => finalPayFor(100.02, 8.33).thirteenthDue);
  assert.equal(dueOff, 0, "flag OFF: final pay owes nothing, so the screening flag is never cleared by payroll");
  assert.equal(dueOn, 0.01, "flag ON: final pay and the screening agree on the 0.01");
});
