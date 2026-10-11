import assert from "node:assert/strict";
import test from "node:test";
import { estimateMonthlyTakeHome } from "../src/lib/take-home-estimate";

const AS_OF = "2026-10-08";

test("a ₱30,000 monthly salary uses 2026 statutory shares and the monthly tax table", () => {
  const result = estimateMonthlyTakeHome({ monthlyBasic: 30000, asOf: AS_OF });
  assert.equal(result.sss, 1500); // 5% of ₱30,000 MSC
  assert.equal(result.philHealth, 750); // 2.5% of ₱30,000
  assert.equal(result.pagIbig, 200); // 2% of the ₱10,000 fund salary cap
  assert.equal(result.taxableCompensation, 27550);
  // 15% of the excess over ₱20,833: (27,550 - 20,833) × 0.15 = 1,007.55
  assert.equal(result.withholdingTax, 1007.55);
  assert.equal(result.netPay, 30000 - 1500 - 750 - 200 - 1007.55);
});

test("PhilHealth stays on basic salary while SSS and Pag-IBIG include taxable allowances", () => {
  const base = estimateMonthlyTakeHome({ monthlyBasic: 20000, asOf: AS_OF });
  const withAllowance = estimateMonthlyTakeHome({ monthlyBasic: 20000, taxableAllowances: 5000, asOf: AS_OF });
  assert.equal(withAllowance.philHealth, base.philHealth);
  assert.equal(withAllowance.sss, 1250);
  assert.equal(base.sss, 1000);
});

test("de minimis is added to pay without tax and voluntary Pag-IBIG reduces net without reducing tax", () => {
  const base = estimateMonthlyTakeHome({ monthlyBasic: 40000, asOf: AS_OF });
  const extras = estimateMonthlyTakeHome({ monthlyBasic: 40000, nonTaxableAllowances: 2500, voluntaryPagIbig: 500, asOf: AS_OF });
  assert.equal(extras.withholdingTax, base.withholdingTax);
  assert.equal(extras.netPay, base.netPay + 2500 - 500);
});

test("minimum wage earners pay tax only on supplementary taxable pay after contributions", () => {
  const mwe = estimateMonthlyTakeHome({ monthlyBasic: 16000, mwe: true, asOf: AS_OF });
  assert.equal(mwe.withholdingTax, 0);
  assert.equal(mwe.taxableCompensation, 0);
  const regular = estimateMonthlyTakeHome({ monthlyBasic: 16000, mwe: false, asOf: AS_OF });
  assert.equal(regular.withholdingTax, 0, "₱16,000 is under the ₱20,833 zero bracket anyway");
});

test("a raise scenario shows the marginal effect on take-home", () => {
  const current = estimateMonthlyTakeHome({ monthlyBasic: 30000, asOf: AS_OF });
  const raised = estimateMonthlyTakeHome({ monthlyBasic: 35000, asOf: AS_OF });
  assert.ok(raised.netPay > current.netPay);
  assert.ok(raised.netPay - current.netPay < 5000, "contributions and tax absorb part of the raise");
});

test("invalid amounts are rejected", () => {
  assert.throws(() => estimateMonthlyTakeHome({ monthlyBasic: -1 }), /Monthly basic salary/);
  assert.throws(() => estimateMonthlyTakeHome({ monthlyBasic: Number.NaN }), /Monthly basic salary/);
  assert.throws(() => estimateMonthlyTakeHome({ monthlyBasic: 1000, taxableAllowances: 2e8 }), /Taxable allowances/);
});
