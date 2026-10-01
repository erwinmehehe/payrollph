import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { computeThirteenthMonthPay } from "../src/lib/ph-compliance";
import { THIRTEENTH_MONTH_EXEMPTION_CAP } from "../src/lib/annualization";
import { isBelowMinimum, wageOrderFor, WAGE_ORDERS } from "../src/lib/wage-orders";

/**
 * Cross-checks 13th-month pay and the minimum-wage table against
 * open-payroll-data/philippines-payroll-data (MIT), pinned in
 * tests/fixtures/open-payroll-data (see that folder's README).
 *
 * 13th-month pay is "stable" in the reference and checked by equality.
 * Minimum wage is "continuously-changing" there: a region's rate is a fact
 * about that region, not a formula, and new Wage Orders replace it without
 * notice. So this does not assert Linaw's peso figures match the reference
 * (that would mean editing this test every time either side re-pulls NWPC's
 * matrix for an unrelated reason). Instead it compares Wage Order NUMBERS,
 * which are a named, citable fact: "WO-RB-III-24" being superseded by
 * "RBIII-26" is true regardless of what the actual new peso rate is. See the
 * pin test below for what that comparison currently shows.
 */

const thirteenthMonth = JSON.parse(readFileSync("tests/fixtures/open-payroll-data/13th_month_pay.json", "utf8")) as {
  computation: string;
  tax_exempt_ceiling: number;
  ceiling_scope: string;
};

type MinWageRegion = { region: string; wage_order: string; daily_min_low: number; daily_min_high: number };
const minWage = JSON.parse(readFileSync("tests/fixtures/open-payroll-data/min_wage_2025.json", "utf8")) as {
  regions: MinWageRegion[];
};

test("13th-month pay is total basic salary earned over the year, divided by 12", () => {
  assert.equal(thirteenthMonth.computation, "total_basic_salary_earned_in_year / 12");
  for (const earned of [0, 1, 360_000.5, 1_234_567.89]) {
    assert.equal(computeThirteenthMonthPay(earned), Math.round((earned / 12 + Number.EPSILON) * 100) / 100, `at ${earned}`);
  }
});

test("the tax-exempt ceiling and what it covers match the reference", () => {
  assert.equal(THIRTEENTH_MONTH_EXEMPTION_CAP, thirteenthMonth.tax_exempt_ceiling);
  assert.match(
    thirteenthMonth.ceiling_scope,
    /13th-month.*Christmas.*mid-year.*performance.*similar benefits/,
    "the ceiling is combined across 13th month and other similar bonuses, not just 13th month alone",
  );
});

test("isBelowMinimum and wageOrderFor read the table correctly, independent of which rates are in it", () => {
  // Arithmetic correctness, not rate correctness: this must hold whichever
  // Wage Orders WAGE_ORDERS happens to contain.
  assert.equal(wageOrderFor("A region nobody configured"), WAGE_ORDERS[0], "unknown region falls back to the first row, not undefined");

  const daily = wageOrderFor("NCR").dailyRate;
  assert.equal(isBelowMinimum(daily * 22, "NCR", 22).order, wageOrderFor("NCR"));
  // 1 centavo under and 1 centavo over the regional daily rate, scaled to a month.
  assert.equal(isBelowMinimum((daily - 0.01) * 22, "NCR", 22).below, true);
  assert.equal(isBelowMinimum(daily * 22, "NCR", 22).below, false, "exactly the floor is not below it");
  assert.equal(isBelowMinimum((daily + 0.01) * 22, "NCR", 22).below, false);
});

test("minimum wage: which of Linaw's regions carry a citable rate at all", () => {
  // The 17-region (incl. BARMM) NWPC matrix vs. the 5 Linaw hardcodes. This is a
  // pin, not a permanent failure: it documents today's gap so a PR that adds or
  // removes a region updates this count on purpose. See src/lib/wage-orders.ts's
  // own comment: these are demo values, "should be verified ... before a
  // customer relies on them," not a claim of national coverage.
  assert.equal(minWage.regions.length, 17, "reference region count changed; re-check the mapping below");
  assert.equal(WAGE_ORDERS.length, 5);
  const covered = new Set(WAGE_ORDERS.map((order) => order.region));
  const REGION_NAME = { NCR: "NCR", III: "Region III", "IV-A": "Region IV-A", VII: "Region VII", XI: "Region XI" };
  assert.deepEqual(Object.keys(REGION_NAME).sort(), [...covered].sort(), "WAGE_ORDERS gained or lost a region; update REGION_NAME");
  const missing = minWage.regions.map((r) => r.region).filter((region) => !Object.values(REGION_NAME).includes(region));
  assert.deepEqual(
    missing.sort(),
    ["BARMM", "CAR", "Region I", "Region II", "Region IV-B", "Region IX", "Region V", "Region VI", "Region VIII", "Region X", "Region XII", "Region XIII"].sort(),
    "12 of 17 NWPC regions have no WAGE_ORDERS entry at all",
  );
});

test("minimum wage: which of Linaw's 5 covered regions cite the Wage Order NWPC's matrix currently shows", () => {
  const REGION_NAME: Record<string, string> = { NCR: "NCR", III: "Region III", "IV-A": "Region IV-A", VII: "Region VII", XI: "Region XI" };
  const orderNumber = (code: string) => Number(code.match(/(\d+)$/)?.[1]);

  const findings = WAGE_ORDERS.map((order) => {
    const current = minWage.regions.find((r) => r.region === REGION_NAME[order.region]);
    assert.ok(current, `no reference entry for ${order.region}`);
    return {
      region: order.region,
      linawOrder: order.wageOrder,
      linawNumber: orderNumber(order.wageOrder),
      currentOrder: current.wage_order,
      currentNumber: orderNumber(current.wage_order),
    };
  });

  const stale = findings.filter((f) => f.linawNumber < f.currentNumber).map((f) => f.region);
  // This is the actual finding, not a hypothetical: as of the pinned NWPC matrix
  // (2026-02-25), only NCR's Wage Order is current. III, IV-A, VII and XI cite an
  // order NWPC has since superseded. The replacement peso rate is NOT applied here
  // automatically (this repo's own rule: never guess a government figure from a
  // third party), it is a prompt to pull the matrix at wage-orders.ts's cited URL
  // and update WAGE_ORDERS deliberately. If this assertion starts failing because
  // WAGE_ORDERS was updated, update the expected list below to match.
  const detail = findings.map((f) => `${f.region}: Linaw ${f.linawOrder} vs NWPC matrix ${f.currentOrder}`).join("\n");
  assert.deepEqual(stale.sort(), ["III", "IV-A", "VII", "XI"].sort(), `Wage Order freshness changed. Current comparison:\n${detail}`);

  const current = findings.filter((f) => f.linawNumber >= f.currentNumber).map((f) => f.region);
  assert.deepEqual(current, ["NCR"]);
});
