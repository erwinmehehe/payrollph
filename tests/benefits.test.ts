import assert from "node:assert/strict";
import test from "node:test";
import {
  BENEFIT_CATEGORIES,
  calculateBenefits,
  employerBenefitCost,
  validateContribution,
  type BenefitPlanInput,
} from "../src/lib/benefits";

const plan = (over: Partial<BenefitPlanInput> = {}): BenefitPlanInput => ({
  id: 1,
  name: "Maxicare HMO",
  category: "hmo",
  employeeShare: 1500,
  employerShare: 2500,
  cap: null,
  ...over,
});

const mp2 = plan({
  id: 2,
  name: "Pag-IBIG MP2",
  category: "voluntary",
  employeeShare: 500,
  employerShare: 0,
  cap: 5000,
});

test("categories cover HMO, insurance, voluntary savings and allowances", () => {
  assert.deepEqual(BENEFIT_CATEGORIES, ["hmo", "insurance", "voluntary", "allowance"]);
});

test("monthly employee share is halved for a semi-monthly run", () => {
  const [line] = calculateBenefits([{ plan: plan(), monthlyContribution: 0, active: true }]);
  assert.equal(line.amount, -750);
  assert.equal(line.category, "hmo");
});

test("an employer-paid benefit produces no deduction", () => {
  const employerOnly = plan({ employeeShare: 0, employerShare: 4000 });
  assert.deepEqual(calculateBenefits([{ plan: employerOnly, monthlyContribution: 0, active: true }]), []);
  assert.equal(employerBenefitCost([{ plan: employerOnly, monthlyContribution: 0, active: true }]), 4000);
});

test("a voluntary MP2 contribution above the legal cap is clamped", () => {
  const [line] = calculateBenefits([{ plan: mp2, monthlyContribution: 9000, active: true }]);
  assert.equal(line.amount, -2500);
  assert.ok(line.basis.includes("cap ₱5000.00"), `basis should cite the cap, got ${line.basis}`);
});

test("an employee-chosen amount overrides the plan default", () => {
  const [line] = calculateBenefits([{ plan: mp2, monthlyContribution: 3000, active: true }]);
  assert.equal(line.amount, -1500);
});

test("inactive enrolments contribute nothing", () => {
  assert.deepEqual(calculateBenefits([
    { plan: plan(), monthlyContribution: 0, active: false },
    { plan: mp2, monthlyContribution: 0, active: false },
  ]), []);
});

test("multiple enrolments aggregate into separate traceable lines", () => {
  const lines = calculateBenefits([
    { plan: plan(), monthlyContribution: 0, active: true },
    { plan: mp2, monthlyContribution: 500, active: true },
  ]);
  assert.equal(lines.length, 2);
  assert.equal(lines.reduce((sum, line) => sum + Math.abs(line.amount), 0), 1000);
});

test("contribution validation catches caps, negatives and unaffordable amounts", () => {
  assert.deepEqual(validateContribution(mp2, 2000, 20_000).problems, []);
  assert.ok(validateContribution(mp2, 9000, 20_000).problems[0].includes("cap"));
  assert.ok(validateContribution(mp2, -5, 20_000).problems[0].includes("negative"));
  // 30,000 breaches both the cap and take-home pay; both must be reported.
  const both = validateContribution(mp2, 30_000, 12_000);
  assert.equal(both.problems.length, 2);
  assert.ok(both.problems.some((p) => p.includes("cap")));
  assert.ok(both.problems.some((p) => p.includes("take-home")));
});

test("every line is traceable to its plan and rule basis", () => {
  const [line] = calculateBenefits([{ plan: plan(), monthlyContribution: 0, active: true }]);
  assert.equal(line.planId, 1);
  assert.equal(line.code, "BEN-1");
  assert.ok(line.basis.includes("÷ 2"));
});
