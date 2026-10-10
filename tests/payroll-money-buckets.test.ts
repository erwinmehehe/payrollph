import assert from "node:assert/strict";
import test from "node:test";
import { roundedGrossFromBuckets, statutoryTrueUpDecision } from "../src/lib/payroll-money";

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
