import assert from "node:assert/strict";
import test from "node:test";
import { reviewRetroStatutorySourcePeriods } from "../src/lib/payroll-retro-statutory-source-period";

const period = { currentPeriodStart: "2026-10-16", currentPeriodEnd: "2026-10-31" };
const retro = { id: 42, amount: 750.25, sourcePeriodStart: "2026-10-01", sourcePeriodEnd: "2026-10-15" };

test("M-10: same-month sourced retro does not cause a false review warning", () => {
  assert.deepEqual(reviewRetroStatutorySourcePeriods({ ...period, adjustments: [retro] }), []);
});
test("M-10: earlier source month requires SSS and Pag-IBIG review", () => {
  const flags = reviewRetroStatutorySourcePeriods({
    ...period, adjustments: [{ ...retro, sourcePeriodStart: "2026-09-01", sourcePeriodEnd: "2026-09-15" }],
  });
  assert.equal(flags.length, 1);
  assert.match(flags[0], /STATUTORY_RETRO_PRIOR_MONTH_REVIEW/);
});
test("M-10: missing, cross-month or impossible source dates fail closed", () => {
  for (const dates of [
    { sourcePeriodStart: null, sourcePeriodEnd: null },
    { sourcePeriodStart: "2026-09-30", sourcePeriodEnd: "2026-10-15" },
    { sourcePeriodStart: "2026-02-30", sourcePeriodEnd: "2026-03-01" },
    { sourcePeriodStart: "2026-10-31", sourcePeriodEnd: "2026-10-01" },
  ]) {
    const flags = reviewRetroStatutorySourcePeriods({ ...period, adjustments: [{ ...retro, ...dates }] });
    assert.equal(flags.length, 1);
    assert.match(flags[0], /STATUTORY_RETRO_SOURCE_UNVERIFIED/);
  }
});
test("M-10: zero retro is ignored, nonfinite amount and bad cutoff are blocked", () => {
  assert.deepEqual(reviewRetroStatutorySourcePeriods({
    ...period, adjustments: [{ ...retro, amount: 0, sourcePeriodStart: null }],
  }), []);
  assert.match(reviewRetroStatutorySourcePeriods({
    ...period, adjustments: [{ ...retro, amount: Number.NaN }],
  })[0], /STATUTORY_RETRO_INVALID_SOURCE/);
  assert.match(reviewRetroStatutorySourcePeriods({
    currentPeriodStart: "2026-09-25", currentPeriodEnd: "2026-10-10", adjustments: [retro],
  })[0], /STATUTORY_RETRO_SOURCE_UNVERIFIED/);
});
