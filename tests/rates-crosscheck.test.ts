import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  computeAnnualWithholdingTax,
  computeMonthlyWithholdingTax,
  computePagIbig,
  computePhilHealth,
  computeSemiMonthlyWithholdingTax,
  computeSss,
} from "../src/lib/payroll-rules";

/**
 * Cross-checks Linaw's statutory rate functions against an independent
 * transcription of the same government tables: open-payroll-data/philippines-payroll-data
 * (MIT), pinned in tests/fixtures/open-payroll-data. See that folder's README.
 *
 * What a pass means: two separate people transcribed the same circulars and
 * agree. What it does not mean: that either is right. The fixture's own claims of
 * primary sourcing are unverified here, so a failure is a prompt to read the cited
 * circular, not proof that Linaw is wrong, and a pass is not a substitute for that.
 */

const load = <T>(name: string) =>
  JSON.parse(readFileSync(`tests/fixtures/open-payroll-data/${name}.json`, "utf8")) as T;

type SssBracket = {
  comp_min: number;
  comp_max: number | null;
  msc: number;
  reg_ss_msc: number;
  mpf_msc: number;
  employee: number;
  employer: number;
  ec: number;
  total_incl_ec: number;
};
type TaxBracket = { over: number; not_over: number | null; base_tax: number; rate: number; of_excess_over: number };

const sss = load<{ brackets: SssBracket[]; rules: Record<string, number> }>("sss_2025");
const tax = load<{ annual: TaxBracket[]; monthly: TaxBracket[]; semi_monthly: TaxBracket[] }>("income_tax_2025");
const philhealth = load<{ rate: number; salary_floor: number; salary_ceiling: number; min_premium_total: number; max_premium_total: number }>("philhealth_2025");
const pagibig = load<{
  mfs_cap: number;
  max_each: number;
  tiers: Array<{ comp_min: number; comp_max: number | null; employee_rate: number; employer_rate: number }>;
}>("pagibig_2025");

const cents = (value: number) => Math.round(value * 100);

test("SSS: every bracket in the reference table matches computeSss at its edges and middle", () => {
  assert.equal(sss.brackets.length, 61, "MSC 5,000 to 35,000 in steps of 500");
  const mismatches: string[] = [];

  for (const bracket of sss.brackets) {
    // The reference uses .99 upper bounds so whole-peso salaries map unambiguously.
    const top = bracket.comp_max ?? bracket.comp_min + 2_000;
    const samples = [bracket.comp_min, (bracket.comp_min + top) / 2, Math.floor(top)];
    for (const salary of samples) {
      const result = computeSss(salary);
      const got = [result.monthlySalaryCredit, result.employee, result.employer, result.employerEC, result.total];
      const want = [bracket.msc, bracket.employee, bracket.employer, bracket.ec, bracket.total_incl_ec];
      if (got.some((value, index) => cents(value) !== cents(want[index]))) {
        mismatches.push(`salary ${salary}: Linaw [msc,ee,er,ec,total]=${got} reference=${want}`);
      }
    }
  }
  assert.deepEqual(mismatches, [], "SSS disagrees with the reference table");
});

test("SSS: the reference's regular/MPF split matches how the R-3 draft divides the credit", () => {
  // exporters.ts splits the credit at 20,000 into regular SS and MPF. Check the same rule.
  const REGULAR_SS_CAP = sss.rules.mpf_threshold;
  assert.equal(REGULAR_SS_CAP, 20_000);
  for (const bracket of sss.brackets) {
    assert.equal(bracket.reg_ss_msc, Math.min(bracket.msc, REGULAR_SS_CAP), `regular MSC at ${bracket.msc}`);
    assert.equal(bracket.mpf_msc, Math.max(0, bracket.msc - REGULAR_SS_CAP), `MPF MSC at ${bracket.msc}`);
  }
});

test("SSS: the EC step sits where the reference says it does", () => {
  assert.equal(sss.rules.ec_low, 10);
  assert.equal(sss.rules.ec_high, 30);
  assert.equal(computeSss(14_749).employerEC, sss.rules.ec_low, "MSC 14,500");
  assert.equal(computeSss(14_750).employerEC, sss.rules.ec_high, "MSC 15,000");
});

test("PhilHealth: premium, floor and ceiling match the reference", () => {
  assert.equal(philhealth.rate, 0.05);
  const salaries = [0, 5_000, philhealth.salary_floor - 1, philhealth.salary_floor, 25_000, 77_777, philhealth.salary_ceiling, 250_000];
  for (const salary of salaries) {
    const base = Math.min(Math.max(salary, philhealth.salary_floor), philhealth.salary_ceiling);
    const total = cents(base * philhealth.rate) / 100;
    const result = computePhilHealth(salary);
    // The premium is split equally, so for an odd-peso salary each half is a half-centavo
    // (77,777 -> 3,888.85 -> 1,944.425 each). computePhilHealth rounds each share up, so
    // the two shares can add to one centavo MORE than the premium. That is within a centavo
    // of the reference and nothing here says which way PhilHealth rounds, so it is tolerated
    // and called out in the PR as a policy question, not asserted as correct.
    assert.ok(Math.abs(cents(result.employee + result.employer) - cents(total)) <= 1, `total premium at ${salary}`);
    assert.ok(Math.abs(cents(result.employee) - cents(total / 2)) <= 1, `employee half at ${salary}`);
  }
  assert.equal(computePhilHealth(0).employee * 2, philhealth.min_premium_total, "minimum total premium");
  assert.equal(computePhilHealth(1_000_000).employee * 2, philhealth.max_premium_total, "maximum total premium");
});

test("Pag-IBIG: tiers and the fund-salary cap match the reference", () => {
  assert.equal(pagibig.mfs_cap, 10_000);
  for (const salary of [0, 800, 1_500, 1_500.01, 1_501, 5_000, 9_999, 10_000, 10_001, 80_000]) {
    const tier = pagibig.tiers.find((item) => salary >= item.comp_min && (item.comp_max === null || salary <= item.comp_max));
    assert.ok(tier, `no reference tier for ${salary}`);
    const base = Math.min(salary, pagibig.mfs_cap);
    const result = computePagIbig(salary);
    assert.equal(cents(result.employee), cents(base * tier.employee_rate), `employee at ${salary}`);
    assert.equal(cents(result.employer), cents(base * tier.employer_rate), `employer at ${salary}`);
  }
  assert.equal(computePagIbig(1_000_000).employee, pagibig.max_each);
  assert.equal(computePagIbig(1_000_000).employer, pagibig.max_each);
});

function referenceTax(table: TaxBracket[], income: number) {
  const bracket = table.find((item) => income > item.over && (item.not_over === null || income <= item.not_over)) ?? table[0];
  return bracket.base_tax + bracket.rate * (income - bracket.of_excess_over);
}

function samplePoints(table: TaxBracket[]) {
  const points: number[] = [];
  for (const bracket of table) {
    const top = bracket.not_over ?? bracket.over * 1.5;
    points.push(bracket.over + 1, (bracket.over + top) / 2, top);
  }
  return points.map((value) => Math.round(value));
}

test("annual TRAIN brackets agree exactly with the reference", () => {
  for (const income of samplePoints(tax.annual)) {
    assert.equal(
      cents(computeAnnualWithholdingTax(income)),
      cents(referenceTax(tax.annual, income)),
      `annual tax at ${income}`,
    );
  }
  assert.equal(computeAnnualWithholdingTax(1_000_000, true), 0, "minimum wage earners are exempt");
});

test("monthly and semi-monthly withholding agree within the reference's own whole-peso rounding", () => {
  // The reference rounds each bracket's base tax to whole pesos (for example 8,542
  // where the exact figure is 8,541.80), and the published semi-monthly thresholds
  // differ from half the monthly ones by a peso. So the honest tolerance is one peso;
  // anything larger is a real disagreement. The worst case is reported, not hidden.
  const TOLERANCE = 1;
  let worst = { diff: 0, label: "" };

  const check = (label: string, linaw: number, reference: number) => {
    const diff = Math.abs(linaw - reference);
    if (diff > worst.diff) worst = { diff, label };
    assert.ok(diff <= TOLERANCE, `${label}: Linaw ${linaw} vs reference ${reference} (off by ${diff.toFixed(2)})`);
  };

  for (const income of samplePoints(tax.monthly)) {
    check(`monthly at ${income}`, computeMonthlyWithholdingTax(income), referenceTax(tax.monthly, income));
  }
  for (const income of samplePoints(tax.semi_monthly)) {
    check(`semi-monthly at ${income}`, computeSemiMonthlyWithholdingTax(income), referenceTax(tax.semi_monthly, income));
  }
  console.info(`rates-crosscheck: largest withholding difference ${worst.diff.toFixed(2)} PHP (${worst.label})`);
  assert.equal(computeMonthlyWithholdingTax(100_000, true), 0, "minimum wage earners are exempt");
});

test("the monthly table's bracket edges are the same numbers Linaw hard-codes", () => {
  const edges = tax.monthly.map((item) => item.not_over).filter((value): value is number => value !== null);
  assert.deepEqual(edges, [20_833, 33_333, 66_667, 166_667, 666_667]);
  // Just under and just over each edge must not jump by more than a peso of tax.
  for (const edge of edges) {
    const jump = computeMonthlyWithholdingTax(edge + 1) - computeMonthlyWithholdingTax(edge);
    assert.ok(jump >= 0 && jump < 1, `unexpected jump at ${edge}: ${jump}`);
  }
});
