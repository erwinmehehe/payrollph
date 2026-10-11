import assert from "node:assert/strict";
import test from "node:test";
import { roundedGrossFromBuckets, statutoryTrueUpDecision } from "../src/lib/payroll-money";
import { computeSemiMonthlyWithholdingTax } from "../src/lib/payroll-rules";

test("rounded gross matches displayed overtime and holiday premium cents", () => {
  // Half-cent floating-point edge and a reproducible multi-bucket mismatch.
  // The engine must sum what line items actually print, never raw fractions.
  const overtime = 1.25 * 113.6368;
  const holidayPremium = 17.046;
  const overtimePrinted = Math.round((overtime + Number.EPSILON) * 100) / 100;
  const holidayPrinted = Math.round((holidayPremium + Number.EPSILON) * 100) / 100;
  const result = roundedGrossFromBuckets([overtime, holidayPremium]);
  assert.equal(result, Math.round((overtimePrinted + holidayPrinted) * 100) / 100);
  assert.notEqual(result, Math.round((overtime + holidayPremium) * 100) / 100);
});

test("each signed bucket is rounded independently, not raw float sum", () => {
  assert.equal(roundedGrossFromBuckets([100, 0.004, 0.004]), 100);
  assert.equal(roundedGrossFromBuckets([100, 0.006, 0.006]), 100.02);
  assert.equal(roundedGrossFromBuckets([100, -0.005]), 100);
  assert.throws(() => roundedGrossFromBuckets([Number.NaN]), /Non-finite/);
});

test("a supplied zero-valued first-cutoff ledger still triggers a true-up", () => {
  assert.deepEqual(statutoryTrueUpDecision({
    isFinalCutoffOfMonth: true, priorCutoffPresent: true, newHireInCurrentCutoff: false,
  }), { canTrueUp: true, missingPriorInput: false });
});

test("missing prior ledger on final cutoff fails closed, new hires use actual final cutoff", () => {
  assert.deepEqual(statutoryTrueUpDecision({
    isFinalCutoffOfMonth: true, priorCutoffPresent: false, newHireInCurrentCutoff: false,
  }), { canTrueUp: false, missingPriorInput: true });
  assert.deepEqual(statutoryTrueUpDecision({
    isFinalCutoffOfMonth: true, priorCutoffPresent: false, newHireInCurrentCutoff: true,
  }), { canTrueUp: true, missingPriorInput: false });
  assert.deepEqual(statutoryTrueUpDecision({
    isFinalCutoffOfMonth: false, priorCutoffPresent: false, newHireInCurrentCutoff: false,
  }), { canTrueUp: false, missingPriorInput: false });
});

test("mid-cutoff hire: calculate withholding on rounded taxable centavos, never latent raw salary fractions", () => {
  const rawGross = (44000 / 2) * (8 / 15);
  const gross = roundedGrossFromBuckets([rawGross]);
  const sss = 587.50;
  const philHealth = 550.00;
  const pagIbig = 100.00;
  const taxable = roundedGrossFromBuckets([gross, -sss, -philHealth, -pagIbig]);
  const withholding = computeSemiMonthlyWithholdingTax(taxable, false, "2026-09-15");
  const deductions = roundedGrossFromBuckets([sss, philHealth, pagIbig, withholding]);
  const net = roundedGrossFromBuckets([gross, -deductions]);

  assert.equal(gross, 11733.33);
  assert.equal(taxable, 10495.83);
  assert.equal(withholding, 11.82);
  assert.equal(deductions, 1249.32);
  assert.equal(net, 10484.01);
  // Unrounded prorating leaked 0.003333 peso into WHT and rounded its
  // half-cent intermediate upward to 11.83. That older result is invalid
  // under the explicit centavo-first withholding computation.
  assert.equal(computeSemiMonthlyWithholdingTax(rawGross - sss - philHealth - pagIbig, false, "2026-09-15"), 11.83);
});
