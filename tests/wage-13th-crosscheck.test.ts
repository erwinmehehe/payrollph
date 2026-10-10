import assert from "node:assert/strict";
import test from "node:test";
import { computeThirteenthMonthPay } from "../src/lib/ph-compliance";
import { THIRTEENTH_MONTH_EXEMPTION_CAP } from "../src/lib/annualization";
import { isBelowMinimum, wageOrderFor, WAGE_ORDERS } from "../src/lib/wage-orders";

const thirteenthMonth = {
  computation: "total_basic_salary_earned_in_year / 12",
  tax_exempt_ceiling: 90_000,
  ceiling_scope: "13th-month Christmas mid-year performance and similar benefits",
} as const;

const OFFICIAL_WAGE_SCREENING_SNAPSHOT_2026_10_03 = [
  ["NCR", "WO-NCR-28", 755, "2026-09-26"],
  ["CAR", "WO-CAR-24", 505, "2025-12-30"],
  ["I", "WO-RB1-24", 505, "2025-11-19"],
  ["II", "WO-RTWPB 2-24", 500, "2025-11-05"],
  ["III", "WO-RBIII-26", 600, "2026-04-16"],
  ["IV-A", "WO-IVA-22", 600, "2025-10-05"],
  ["IV-B", "WO-RB-MIMAROPA-13", 455, "2026-01-01"],
  ["V", "WO-RBV-23", 455, "2026-04-08"],
  ["VI", "WO-RBVI-29", 550, "2025-11-19"],
  ["VII", "WO-ROVII-26", 540, "2025-10-04"],
  ["VIII", "WO-RB VIII-25", 470, "2026-06-01"],
  ["IX", "WO-RIX-24", 464, "2026-06-01"],
  ["X", "WO-RX-24", 500, "2026-05-01"],
  ["XI", "WO-RB XI-24", 540, "2026-09-01"],
  ["XII", "WO-RXII-25", 460, "2025-12-15"],
  ["XIII", "WO-RXIII-20", 475, "2026-05-01"],
  ["BARMM", "WO-BARMM-05", 436, "2026-08-06"],
] as const;

test("13th-month pay is total basic salary earned over the year, divided by 12", () => {
  assert.equal(thirteenthMonth.computation, "total_basic_salary_earned_in_year / 12");
  for (const earned of [0, 1, 360_000.5, 1_234_567.89]) {
    assert.equal(
      computeThirteenthMonthPay(earned),
      Math.round((earned / 12 + Number.EPSILON) * 100) / 100,
      `at ${earned}`,
    );
  }
});

test("the 90k tax-exempt ceiling and combined-benefit scope match the reference", () => {
  assert.equal(THIRTEENTH_MONTH_EXEMPTION_CAP, thirteenthMonth.tax_exempt_ceiling);
  assert.match(
    thirteenthMonth.ceiling_scope,
    /13th-month.*Christmas.*mid-year.*performance.*similar benefits/,
    "the ceiling is combined across 13th month and similar bonuses, not per benefit",
  );
});

test("isBelowMinimum and wageOrderFor apply the configured table correctly", () => {
  assert.throws(
    () => wageOrderFor("A region nobody configured"),
    /Unknown Philippine wage region/,
    "unknown region must fail closed; do not mislabel it NCR",
  );

  const daily = wageOrderFor("NCR").dailyRate;
  assert.equal(isBelowMinimum(daily * 22, "NCR", 22).order, wageOrderFor("NCR"));
  assert.equal(isBelowMinimum((daily - 0.01) * 22, "NCR", 22).below, true);
  assert.equal(isBelowMinimum(daily * 22, "NCR", 22).below, false);
  assert.equal(isBelowMinimum((daily + 0.01) * 22, "NCR", 22).below, false);
});

test("all 17 configured wage screening rows match the official 2026-10-03 snapshot", () => {
  assert.equal(WAGE_ORDERS.length, OFFICIAL_WAGE_SCREENING_SNAPSHOT_2026_10_03.length);
  for (const [region, wageOrder, dailyRate, effectiveOn] of OFFICIAL_WAGE_SCREENING_SNAPSHOT_2026_10_03) {
    const configured = wageOrderFor(region);
    assert.equal(configured.wageOrder, wageOrder, `${region}: wage order`);
    assert.equal(configured.dailyRate, dailyRate, `${region}: current high-tier screening rate`);
    assert.equal(configured.effectiveOn, effectiveOn, `${region}: rate effective date`);
    assert.equal(configured.verified, true, `${region}: official source verification`);
  }
});


