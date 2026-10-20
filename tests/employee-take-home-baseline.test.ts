import assert from "node:assert/strict";
import test from "node:test";
import {
  employeeTakeHomeReadError, parseEmployeeTakeHomeBaseline,
} from "../src/lib/employee-take-home-baseline";

const valid = {
  asOf: "2026-10-20",
  baseline: { monthlyBasic: 30000, payBasis: "monthly", mwe: false },
  estimate: {
    monthlyBasic: 30000, taxableAllowances: 0, nonTaxableAllowances: 0,
    gross: 30000, sss: 1500, philHealth: 750, pagIbig: 200,
    voluntaryPagIbig: 0, taxableCompensation: 27550,
    withholdingTax: 1007.55, totalDeductions: 3457.55, netPay: 26542.45,
  },
  note: "A fictional regular-month estimate, not a payslip.",
};

test("valid private monthly estimate is accepted without rewriting values", () => {
  assert.deepEqual(parseEmployeeTakeHomeBaseline(valid), valid);
});

test("HTTP 200 is not enough when the baseline, as-of or estimate is malformed", () => {
  const invalid = [
    null,
    {},
    { ...valid, asOf: "2026-02-30" },
    { ...valid, asOf: "2026-10-20T00:00:00Z" },
    { ...valid, baseline: null },
    { ...valid, baseline: { ...valid.baseline, monthlyBasic: "30000" } },
    { ...valid, baseline: { ...valid.baseline, monthlyBasic: -1 } },
    { ...valid, baseline: { ...valid.baseline, mwe: "false" } },
    { ...valid, estimate: null },
    { ...valid, estimate: { ...valid.estimate, netPay: "26542.45" } },
    { ...valid, estimate: { ...valid.estimate, netPay: Number.NaN } },
    { ...valid, estimate: { ...valid.estimate, withholdingTax: Number.POSITIVE_INFINITY } },
    { ...valid, estimate: { ...valid.estimate, monthlyBasic: 40000 } },
    { ...valid, estimate: { ...valid.estimate, gross: 32000 } },
    { ...valid, estimate: { ...valid.estimate, totalDeductions: 0 } },
    { ...valid, estimate: { ...valid.estimate, netPay: 30000 } },
    { ...valid, note: { error: "Untrusted server response" } },
  ];
  invalid.forEach((body, index) => {
    assert.equal(parseEmployeeTakeHomeBaseline(body), null, "malformed response " + index);
  });
});

test("a bounded, internally reconciled negative scenario is allowed, not mistaken for malformed JSON", () => {
  const negative = {
    ...valid,
    estimate: {
      ...valid.estimate,
      voluntaryPagIbig: 50000,
      totalDeductions: 53457.55,
      netPay: -23457.55,
    },
  };
  assert.deepEqual(parseEmployeeTakeHomeBaseline(negative), negative);
});

test("401/403/404/409 are distinguishable; unknown failures are generic and disclose no response body", () => {
  assert.match(employeeTakeHomeReadError(401), /Sign in again/);
  assert.match(employeeTakeHomeReadError(403), /cannot view/);
  assert.match(employeeTakeHomeReadError(404), /not found/);
  assert.match(employeeTakeHomeReadError(409), /not set up yet/);
  assert.equal(employeeTakeHomeReadError(503), "We could not load your pay baseline.");
  assert.equal(employeeTakeHomeReadError(418), "We could not load your pay baseline.");
});
