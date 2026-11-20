import assert from "node:assert/strict";
import test from "node:test";
import { wageOrderFor } from "../src/lib/wage-orders";
import {
  REGION_VI30_REVIEW_TIERS,
  REGION_VI30_SOURCE,
  regionVIUnclassifiedReview,
  regionVIWageReference,
  regionVIWorkPeriodReference,
} from "../src/lib/wage-order-region-vi30-review";

/**
 * Official NWPC source checks only; NOT a payroll-engine integration test.
 * See https://nwpc.dole.gov.ph/region-vi/ (Wage Order VI-30,
 * issued 2026-10-21, published 2026-11-04, effective 2026-11-20).
 * The protected live wage-orders.ts remains pinned to VI-29 until independent
 * source dependency / tenant method proof and human compliance review.
 */

test("official VI-30 dated reference preserves the previous order as source history", () => {
  assert.equal(REGION_VI30_SOURCE.authority, "NWPC / RTWPB-VI");
  assert.equal(REGION_VI30_SOURCE.issuedOn, "2026-10-21");
  assert.equal(REGION_VI30_SOURCE.publishedOn, "2026-11-04");
  assert.equal(REGION_VI30_SOURCE.effectiveOn, "2026-11-20");
  assert.equal(REGION_VI30_SOURCE.precedingEffectiveOn, "2025-11-19");
  assert.match(REGION_VI30_SOURCE.sourceUrl, /^https:\/\/nwpc\.dole\.gov\.ph\//);
  assert.deepEqual(Object.keys(REGION_VI30_REVIEW_TIERS).sort(),
    ["agriculture", "nonagri_gt10", "nonagri_le10"].sort());
});

test("three employer categories apply their own real pre/post effectivity rates", () => {
  const tiers = [
    ["nonagri_gt10", 550, 590],
    ["nonagri_le10", 525, 565],
    ["agriculture", 520, 565],
  ] as const;
  for (const [kind, oldRate, newRate] of tiers) {
    const before = regionVIWageReference("2026-11-19", kind);
    const after = regionVIWageReference("2026-11-20", kind);
    const historical = regionVIWageReference("2026-07-15", kind);
    assert.equal(before.dailyRate, oldRate);
    assert.equal(before.wageOrder, "WO-RBVI-29");
    assert.equal(before.effectiveOn, "2025-11-19");
    assert.equal(historical.dailyRate, oldRate);
    assert.equal(after.dailyRate, newRate);
    assert.equal(after.wageOrder, "WO-RBVI-30");
    assert.equal(after.effectiveOn, "2026-11-20");
    assert.equal(regionVIWageReference("2026-11-21", kind).dailyRate, newRate);
    for (const result of [before, after, historical]) {
      assert.equal(result.referenceOnly, true);
      assert.equal(result.independentPayrollReview, "PENDING");
      assert.equal(result.productionPayrollAccepted, false);
    }
  }
});

test("cutoffs crossing November 20 require work-date review, not retroactive repricing", () => {
  const crossing = regionVIWorkPeriodReference("2026-11-16", "2026-11-30", "agriculture");
  assert.equal(crossing.first.dailyRate, 520);
  assert.equal(crossing.last.dailyRate, 565);
  assert.equal(crossing.effectiveDateChange, true);
  assert.equal(crossing.manualWorkDateReviewRequired, true);
  assert.equal(crossing.productionPayrollAccepted, false);
  const old = regionVIWorkPeriodReference("2026-11-01", "2026-11-19", "nonagri_gt10");
  assert.equal(old.effectiveDateChange, false);
  assert.equal(old.manualWorkDateReviewRequired, false);
  assert.equal(old.last.dailyRate, 550);
  const current = regionVIWorkPeriodReference("2026-11-20", "2026-11-30", "nonagri_le10");
  assert.equal(current.effectiveDateChange, false);
  assert.equal(current.last.dailyRate, 565);
});

test("unknown sector, missing work date, malformed date and unverified older history fail closed", () => {
  assert.throws(() => regionVIWageReference("2026-11-20", "unclassified" as never),
    /classification required/);
  assert.throws(() => regionVIWageReference("2026-11-20", undefined as never),
    /classification required/);
  assert.throws(() => regionVIWageReference("2025-11-18", "agriculture"),
    /No source-verified Region VI category history/);
  assert.throws(() => regionVIWageReference("2026-11-31", "nonagri_gt10"),
    /Invalid Region VI wage reference work date/);
  assert.throws(() => regionVIWageReference("2026/11/20", "agriculture"),
    /explicit YYYY-MM-DD/);
  assert.throws(() => regionVIWageReference("", "agriculture"),
    /explicit YYYY-MM-DD/);
  assert.throws(() => regionVIWorkPeriodReference("2026-11-21", "2026-11-19", "agriculture"),
    /starts after it ends/);
});

test("unclassified screening is conservative, not employer-wage, MWE or payroll approval", () => {
  for (const [day, max] of [["2026-11-19", 550], ["2026-11-20", 590]] as const) {
    const r = regionVIUnclassifiedReview(day);
    assert.equal(r.highestListedDailyRate, max);
    assert.equal(r.employerClassVerified, false);
    assert.equal(r.advisoryOnly, true);
    assert.equal(r.productionPayrollAccepted, false);
  }
});

test("security hold: reference candidate MUST NOT silently alter source-pinned live payroll registry", () => {
  const live = wageOrderFor("VI", "2026-11-20");
  assert.equal(live.wageOrder, "WO-RBVI-29");
  assert.equal(live.dailyRate, 550);
  assert.equal(regionVIWageReference("2026-11-20", "nonagri_gt10").dailyRate, 590);
  // A later independently reviewed activation must update this test and all
  // source-dependent proof accounting; it cannot borrow historical credits.
  assert.equal(wageOrderFor("NCR").dailyRate, 755, "other regions are unchanged");
});
