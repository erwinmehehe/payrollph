import assert from "node:assert/strict";
import test from "node:test";
import {
  pagIbigContribution,
  philHealthContribution,
  sssContribution,
  withholdingTaxMonthly,
  withholdingTaxSemiMonthly,
} from "@ph-dev-utils/payroll";
import {
  computeMonthlyWithholdingTax,
  computePagIbig,
  computePhilHealth,
  computeSemiMonthlyWithholdingTax,
  computeSss,
} from "../src/lib/payroll-rules";

function moneyEqual(actual: number, expected: number, label: string) {
  assert.equal(Number(actual.toFixed(2)), Number(expected.toFixed(2)), label);
}

test("Linaw matches independent PH reference for SSS across floors, steps, and caps", () => {
  const salaries = new Set<number>([
    0, 1, 4_749, 4_750, 4_999, 5_000, 5_249, 5_250, 5_499, 14_499, 14_500, 14_749, 14_750,
    14_999, 15_000, 19_999, 20_000, 20_249, 20_250, 34_749, 34_750, 34_999, 35_000, 35_249, 35_250,
    50_000, 100_000,
  ]);
  for (let salary = 0; salary <= 100_000; salary += 250) salaries.add(salary);

  for (const salary of salaries) {
    const linaw = computeSss(salary);
    const reference = sssContribution(salary, { year: 2026 });

    assert.equal(linaw.monthlySalaryCredit, reference.msc, `SSS MSC mismatch at ₱${salary}`);
    moneyEqual(linaw.employee, reference.employeeShare, `SSS employee mismatch at ₱${salary}`);
    moneyEqual(linaw.employerEC, reference.ec, `SSS EC mismatch at ₱${salary}`);
    moneyEqual(
      linaw.employer + linaw.employerEC,
      reference.employerShare,
      `SSS employer mismatch at ₱${salary}`,
    );
    moneyEqual(linaw.total, reference.total, `SSS total mismatch at ₱${salary}`);
  }
});

test("Linaw matches independent PH reference for PhilHealth across floor and ceiling", () => {
  const salaries = new Set<number>([0, 9_999, 10_000, 10_001, 99_999, 100_000, 100_001, 150_000]);
  for (let salary = 0; salary <= 150_000; salary += 500) salaries.add(salary);

  for (const salary of salaries) {
    const linaw = computePhilHealth(salary);
    const reference = philHealthContribution(salary, { year: 2026 });

    moneyEqual(linaw.employee, reference.employee, `PhilHealth employee mismatch at ₱${salary}`);
    moneyEqual(linaw.employer, reference.employer, `PhilHealth employer mismatch at ₱${salary}`);
    moneyEqual(linaw.employee + linaw.employer, reference.total, `PhilHealth total mismatch at ₱${salary}`);
  }
});

test("Linaw matches independent PH reference for Pag-IBIG across bracket and cap", () => {
  const salaries = new Set<number>([0, 1_499, 1_500, 1_501, 9_999, 10_000, 10_001, 50_000]);
  for (let salary = 0; salary <= 50_000; salary += 250) salaries.add(salary);

  for (const salary of salaries) {
    const linaw = computePagIbig(salary);
    const reference = pagIbigContribution(salary, { year: 2026 });

    assert.equal(linaw.fundSalary, reference.mfs, `Pag-IBIG MFS mismatch at ₱${salary}`);
    moneyEqual(linaw.employee, reference.employee, `Pag-IBIG employee mismatch at ₱${salary}`);
    moneyEqual(linaw.employer, reference.employer, `Pag-IBIG employer mismatch at ₱${salary}`);
    moneyEqual(linaw.total, reference.total, `Pag-IBIG total mismatch at ₱${salary}`);
  }
});

test("Linaw monthly BIR withholding matches independent 2023+ TRAIN table", () => {
  const incomes = new Set<number>([
    0, 20_832, 20_833, 20_834, 33_332, 33_333, 33_334, 66_666, 66_667, 66_668,
    166_666, 166_667, 166_668, 666_666, 666_667, 666_668, 1_000_000,
  ]);
  for (let income = 0; income <= 1_000_000; income += 1_250) incomes.add(income);

  for (const income of incomes) {
    const linaw = computeMonthlyWithholdingTax(income);
    const reference = withholdingTaxMonthly(income, { year: 2026 }).wt;
    moneyEqual(linaw, reference, `Monthly BIR withholding mismatch at ₱${income}`);
  }
});

test("Linaw semi-monthly BIR withholding matches independent Annex E table", () => {
  const incomes = new Set<number>([
    0, 10_416, 10_417, 10_418, 16_666, 16_667, 16_668, 33_332, 33_333, 33_334,
    83_332, 83_333, 83_334, 333_332, 333_333, 333_334, 500_000,
  ]);
  for (let income = 0; income <= 500_000; income += 625) incomes.add(income);

  for (const income of incomes) {
    const linaw = computeSemiMonthlyWithholdingTax(income);
    const reference = withholdingTaxSemiMonthly(income, { year: 2026 }).wt;
    moneyEqual(linaw, reference, `Semi-monthly BIR withholding mismatch at ₱${income}`);
  }
});
