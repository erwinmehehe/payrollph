import assert from "node:assert/strict";
import test from "node:test";
import { retroAgencyReconciliationRows, reviewRetroStatutorySourcePeriods } from "../src/lib/payroll-retro-statutory-source-period";

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

test("M-10: reconciliation rows retain source month and signed centavos but never certify agency posting", () => {
  const rows = retroAgencyReconciliationRows({
    ...period,
    adjustments: [
      retro,
      { ...retro, id: 43, amount: -1234.56, sourcePeriodStart: "2025-12-16", sourcePeriodEnd: "2025-12-31" },
      { ...retro, id: 44, amount: 0, sourcePeriodStart: null, sourcePeriodEnd: null },
      { ...retro, id: 45, amount: 100, sourcePeriodStart: "2026-09-30", sourcePeriodEnd: "2026-10-15" },
      { ...retro, id: 46, amount: Number.POSITIVE_INFINITY },
    ],
  });
  assert.deepEqual(rows.map(row => row.status), [
    "same_cutoff_month", "different_source_month", "zero_adjustment", "source_unverified", "invalid_adjustment",
  ]);
  assert.deepEqual(rows.map(row => row.requiresAgencyReview), [false, true, false, true, true]);
  assert.equal(rows[0].amountCentavos, 75025);
  assert.equal(rows[1].amountCentavos, -123456);
  assert.equal(rows[1].sourceWorkMonth, "2025-12");
  assert.equal(rows[1].currentCutoffMonth, "2026-10");
  assert.equal(rows[2].sourceWorkMonth, null);
  assert.equal(rows[3].sourceWorkMonth, null);
  assert.equal(rows[4].amountCentavos, null);
  assert.deepEqual(
    reviewRetroStatutorySourcePeriods({
      ...period,
      adjustments: [
        retro,
        { ...retro, id: 43, amount: -1234.56, sourcePeriodStart: "2025-12-16", sourcePeriodEnd: "2025-12-31" },
        { ...retro, id: 44, amount: 0, sourcePeriodStart: null, sourcePeriodEnd: null },
        { ...retro, id: 45, amount: 100, sourcePeriodStart: "2026-09-30", sourcePeriodEnd: "2026-10-15" },
        { ...retro, id: 46, amount: Number.POSITIVE_INFINITY },
      ],
    }).map(flag => flag.split(":")[0]),
    ["STATUTORY_RETRO_PRIOR_MONTH_REVIEW", "STATUTORY_RETRO_SOURCE_UNVERIFIED", "STATUTORY_RETRO_INVALID_SOURCE"],
  );
});


test("M-10: source amounts that cannot be represented in centavos fail closed", () => {
  const rows = retroAgencyReconciliationRows({
    ...period,
    adjustments: [
      { ...retro, id: 47, amount: 1.234 },
      { ...retro, id: 48, amount: 0.01 },
      { ...retro, id: 49, amount: -0.01 },
      { ...retro, id: 50, amount: Number.MAX_VALUE },
    ],
  });
  assert.deepEqual(rows.map(row => row.status), [
    "invalid_adjustment", "same_cutoff_month", "same_cutoff_month", "invalid_adjustment",
  ]);
  assert.deepEqual(rows.map(row => row.amountCentavos), [null, 1, -1, null]);
  assert.equal(rows[0].requiresAgencyReview, true);
  assert.match(reviewRetroStatutorySourcePeriods({
    ...period,
    adjustments: [{ ...retro, id: 47, amount: 1.234 }],
  })[0], /STATUTORY_RETRO_INVALID_SOURCE/);
});
