import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { computeThirteenthMonthPay } from "../src/lib/ph-compliance";
import { THIRTEENTH_MONTH_EXEMPTION_CAP } from "../src/lib/annualization";
import { isBelowMinimum, wageOrderFor, WAGE_ORDERS } from "../src/lib/wage-orders";

/**
 * Cross-checks stable 13th-month rules and the configured wage-order table
 * against the pinned open-payroll-data/philippines-payroll-data transcription.
 *
 * The wage fixture is deliberately NOT treated as primary-source verification:
 * it exists to catch accidental drift between two separately maintained
 * transcriptions. Every WAGE_ORDERS row remains verified:false until a human
 * checks the cited NWPC/RTWPB source directly.
 */

const thirteenthMonth = JSON.parse(
  readFileSync("tests/fixtures/open-payroll-data/13th_month_pay.json", "utf8"),
) as {
  computation: string;
  tax_exempt_ceiling: number;
  ceiling_scope: string;
};

type MinWageRegion = {
  region: string;
  wage_order: string;
  daily_min_low: number;
  daily_min_high: number;
  effective: string;
};

const minWage = JSON.parse(
  readFileSync("tests/fixtures/open-payroll-data/min_wage_2025.json", "utf8"),
) as {
  matrix_as_of: string;
  regions: MinWageRegion[];
};

const REGION_NAME: Record<string, string> = {
  NCR: "NCR",
  CAR: "CAR",
  I: "Region I",
  II: "Region II",
  III: "Region III",
  "IV-A": "Region IV-A",
  "IV-B": "Region IV-B",
  V: "Region V",
  VI: "Region VI",
  VII: "Region VII",
  VIII: "Region VIII",
  IX: "Region IX",
  X: "Region X",
  XI: "Region XI",
  XII: "Region XII",
  XIII: "Region XIII",
  BARMM: "BARMM",
};

const normalizeOrder = (value: string) => value.replace(/^WO-/, "");

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
  assert.equal(
    wageOrderFor("A region nobody configured"),
    WAGE_ORDERS[0],
    "unknown region falls back to the first configured row",
  );

  const daily = wageOrderFor("NCR").dailyRate;
  assert.equal(isBelowMinimum(daily * 22, "NCR", 22).order, wageOrderFor("NCR"));
  assert.equal(isBelowMinimum((daily - 0.01) * 22, "NCR", 22).below, true);
  assert.equal(isBelowMinimum(daily * 22, "NCR", 22).below, false);
  assert.equal(isBelowMinimum((daily + 0.01) * 22, "NCR", 22).below, false);
});

test("all 17 configured wage-order rows match the pinned independent transcription", () => {
  assert.equal(minWage.regions.length, 17, "reference region count changed");
  assert.equal(WAGE_ORDERS.length, 17, "configured region count changed");
  assert.deepEqual(Object.keys(REGION_NAME).sort(), WAGE_ORDERS.map((row) => row.region).sort());

  for (const order of WAGE_ORDERS) {
    const reference = minWage.regions.find((row) => row.region === REGION_NAME[order.region]);
    assert.ok(reference, `no reference row for ${order.region}`);
    assert.equal(
      normalizeOrder(order.wageOrder),
      reference.wage_order,
      `${order.region}: wage-order identifier drifted from the pinned reference`,
    );
    assert.equal(
      order.dailyRate,
      reference.daily_min_high,
      `${order.region}: configured high-tier daily rate drifted from the pinned reference`,
    );
    assert.equal(
      order.effectiveOn,
      reference.effective,
      `${order.region}: effective date drifted from the pinned reference`,
    );
    assert.equal(
      order.verified,
      false,
      `${order.region}: an independent transcription must not be promoted to primary-source verified automatically`,
    );
  }
});

test("the wage fixture remains explicitly volatile and date-pinned", () => {
  assert.equal(minWage.matrix_as_of, "2026-02-25");
});
