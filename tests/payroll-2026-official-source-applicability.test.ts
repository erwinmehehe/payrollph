/**
 * November 2026 Philippine statutory rule-pack applicability smoke test.
 *
 * Fictional, pure-function values only. This intentionally does NOT modify
 * payroll, authorize a release, claim agency certification, or substitute for
 * the real-engine two-month source/GL reconciliation in issue #1999.
 *
 * Independently transcribed original-source starting points:
 * SSS: https://www.sss.gov.ph/pay-contribution
 *   (Circular 2024-006, employer/employee schedule effective January 2025).
 * HDMF: https://www.pagibigfund.gov.ph/document/pdf/circulars/provident/Circular%20No.%20460%20-%20Guidelines%20on%20the%20Pag-IBIG%20Fund%27s%20Implementation%20of%20Increase%20in%20the%20MFS%20Effective%20February%202024.pdf
 * BIR: https://bir-cdn.bir.gov.ph/local/pdf/Annex%20E%20RR%2011-2018.pdf
 *   (monthly/semi-monthly tables effective January 2023 onward).
 * BIR annual: https://bir-cdn.bir.gov.ph/local/pdf/1700%20Jan%202018%20ENCS%20v6.pdf
 * PhilHealth: https://pia.gov.ph/news/philhealth-sets-5-premium-contribution-rate-for-2026/
 *   (government report of PhilHealth's May 2026 announcement; obtain the
 *    underlying agency advisory before treating as source-certified).
 *
 * SOURCE NOT VERIFIED: PhilHealth's odd-cent EE/ER allocation, software cutoff
 * collection timing, posted remittance acceptance, and all untested 2026 wage
 * tiers/employer categories. These are deliberately NOT asserted as proven.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  computeAnnualWithholdingTax,
  computeMonthlyWithholdingTax,
  computePagIbig,
  computePhilHealth,
  computeSemiMonthlyWithholdingTax,
  computeSss,
} from "../src/lib/payroll-rules";

const AS_OF = "2026-11-16";

function centavos(value: number): number {
  assert.ok(Number.isFinite(value), "A statutory amount must be finite");
  const cents = Math.round((value + Number.EPSILON) * 100);
  assert.ok(Number.isSafeInteger(cents), "Centavo amount exceeds safe integer range");
  return cents;
}

function agree(label: string, actual: number, expected: number): void {
  const deltaCentavos = centavos(actual) - centavos(expected);
  console.log("STATUTORY_2026_SMOKE " + JSON.stringify({
    label, asOf: AS_OF, expected, actual, deltaCentavos,
    status: deltaCentavos === 0 ? "AGREES" : "DISAGREES",
    evidence: "FICTIONAL_PURE_FUNCTION_ONLY",
  }));
  assert.equal(deltaCentavos, 0, label + " must agree at exact centavo");
}

test("2026 effective-date SSS bracket, MPF, and EC values", () => {
  // Official employer and employee table: ER 10%, EE 5%, EC employer-only.
  const rows = [
    { salary: 5249.99, msc: 5000, regularMsc: 5000, mpfMsc: 0, ee: 250, er: 500, ec: 10 },
    { salary: 5250, msc: 5500, regularMsc: 5500, mpfMsc: 0, ee: 275, er: 550, ec: 10 },
    { salary: 10000, msc: 10000, regularMsc: 10000, mpfMsc: 0, ee: 500, er: 1000, ec: 10 },
    { salary: 25250, msc: 25500, regularMsc: 20000, mpfMsc: 5500, ee: 1275, er: 2550, ec: 30 },
    { salary: 34749.99, msc: 34500, regularMsc: 20000, mpfMsc: 14500, ee: 1725, er: 3450, ec: 30 },
    { salary: 34750, msc: 35000, regularMsc: 20000, mpfMsc: 15000, ee: 1750, er: 3500, ec: 30 },
    { salary: 100000, msc: 35000, regularMsc: 20000, mpfMsc: 15000, ee: 1750, er: 3500, ec: 30 },
  ] as const;
  for (const row of rows) {
    const result = computeSss(row.salary, AS_OF);
    const key = "SSS salary " + row.salary;
    agree(key + " MSC", result.monthlySalaryCredit, row.msc);
    agree(key + " regular MSC", result.regularMsc, row.regularMsc);
    agree(key + " MPF MSC", result.mpfMsc, row.mpfMsc);
    agree(key + " employee share", result.employee, row.ee);
    agree(key + " employer share", result.employer, row.er);
    agree(key + " EC", result.employerEC, row.ec);
  }
});

test("2026 PhilHealth reported 5% premium, floor, ceiling (unverified odd-cent split omitted)", () => {
  // 2026 rate/floor/cap in government PIA report of PhilHealth announcement.
  const evenCentRows = [
    { salary: 1500, base: 10000, total: 500, ee: 250, er: 250 },
    { salary: 10000, base: 10000, total: 500, ee: 250, er: 250 },
    { salary: 25000, base: 25000, total: 1250, ee: 625, er: 625 },
    { salary: 100000, base: 100000, total: 5000, ee: 2500, er: 2500 },
    { salary: 100000.01, base: 100000, total: 5000, ee: 2500, er: 2500 },
  ] as const;
  for (const row of evenCentRows) {
    const result = computePhilHealth(row.salary, AS_OF);
    const key = "PhilHealth salary " + row.salary;
    agree(key + " basis", result.base, row.base);
    agree(key + " premium", result.total, row.total);
    agree(key + " employee even-cent share", result.employee, row.ee);
    agree(key + " employer even-cent share", result.employer, row.er);
  }
  // The 5% total is independently computable, but the extra centavo
  // attribution lacks authenticated primary-agency EE/ER guidance.
  const odd = computePhilHealth(10000.2, AS_OF);
  agree("PhilHealth 10000.20 total (odd cent)", odd.total, 500.01);
  console.log("STATUTORY_2026_SMOKE " + JSON.stringify({
    label: "PhilHealth 10000.20 EE/ER odd-cent allocation",
    asOf: AS_OF, status: "SOURCE NOT VERIFIED",
    note: "No source-derived employee/employer centavo allocation is asserted",
  }));
});

test("2026 Pag-IBIG ordinary employed monthly floor and fund-salary ceiling", () => {
  // Circular 460: employee 1% through PHP 1500, 2% above; employer 2%.
  // Fund salary is capped at PHP 10000. No OFW/other member class claimed.
  const rows = [
    { salary: 1500, fund: 1500, ee: 15, er: 30 },
    { salary: 1500.01, fund: 1500.01, ee: 30, er: 30 },
    { salary: 10000, fund: 10000, ee: 200, er: 200 },
    { salary: 100000, fund: 10000, ee: 200, er: 200 },
  ] as const;
  for (const row of rows) {
    const result = computePagIbig(row.salary, AS_OF);
    const key = "Pag-IBIG salary " + row.salary;
    agree(key + " fund salary", result.fundSalary, row.fund);
    agree(key + " employee share", result.employee, row.ee);
    agree(key + " employer share", result.employer, row.er);
  }
});

test("2026 BIR RR 11-2018 2023-onward monthly, semi-monthly, and annual table", () => {
  // Input is already taxable income AFTER qualifying deductions, not gross.
  const monthly = [
    { taxable: 10000, expected: 0 },
    { taxable: 25000, expected: 625.05 },
    { taxable: 40000, expected: 3208.40 },
  ] as const;
  const semi = [
    { taxable: 5000, expected: 0 },
    { taxable: 12000, expected: 237.45 },
    { taxable: 20000, expected: 1604.10 },
  ] as const;
  const annual = [
    { taxable: 250000, expected: 0 },
    { taxable: 500000, expected: 42500 },
    { taxable: 800000, expected: 102500 },
    { taxable: 10000000, expected: 2902500 },
  ] as const;
  for (const row of monthly) {
    agree("BIR monthly taxable " + row.taxable,
      computeMonthlyWithholdingTax(row.taxable, false, AS_OF), row.expected);
  }
  for (const row of semi) {
    agree("BIR semi-monthly taxable " + row.taxable,
      computeSemiMonthlyWithholdingTax(row.taxable, false, AS_OF), row.expected);
  }
  for (const row of annual) {
    agree("BIR annual taxable " + row.taxable,
      computeAnnualWithholdingTax(row.taxable, false, AS_OF), row.expected);
  }
});
