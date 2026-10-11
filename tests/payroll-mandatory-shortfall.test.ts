import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { allocateMandatoryDeductions } from "../src/lib/payroll-mandatory-shortfall";
import { evaluatePayrollAssurance } from "../src/lib/payroll-assurance";

const due = (override: Partial<Parameters<typeof allocateMandatoryDeductions>[1]> = {}) => ({
  sss: 80, philHealth: 40, pagIbig: 10, withholding: 100,
  yearEndTaxAdjustment: 0, tardiness: 0, undertime: 0, ...override,
});

test("M-8 records every uncollected peso while balancing the applied deduction lines", () => {
  const result = allocateMandatoryDeductions(100, due());
  assert.equal(result.requestedTotal, 230);
  assert.equal(result.appliedTotal, 100);
  assert.equal(result.totalUncollected, 130);
  assert.equal(result.applied.withholding, 100);
  assert.equal(result.applied.sss, 0);
  assert.equal(result.uncollected.sss, 80);
  assert.equal(result.uncollected.philHealth, 40);
  assert.equal(result.uncollected.pagIbig, 10);
  assert.equal(result.disposableBeforeOptional, 0);
  assert.equal(100 - result.appliedTotal, result.disposableBeforeOptional);
});

test("normal payroll and a year-end refund still reconcile without invented shortfalls", () => {
  const full = allocateMandatoryDeductions(300, due());
  assert.equal(full.totalUncollected, 0);
  assert.equal(full.appliedTotal, 230);
  assert.equal(full.disposableBeforeOptional, 70);

  const withRefund = allocateMandatoryDeductions(100, due({
    sss: 120, philHealth: 70, pagIbig: 10, withholding: 50, yearEndTaxAdjustment: -50,
  }));
  assert.equal(withRefund.requestedTotal, 200);
  assert.equal(withRefund.appliedTotal, 100);
  assert.equal(withRefund.totalUncollected, 100);
  assert.equal(withRefund.applied.yearEndTaxAdjustment, -50);
  assert.equal(withRefund.disposableBeforeOptional, 0);
});

test("zero gross and exact one-cent shortage cannot disappear", () => {
  const zero = allocateMandatoryDeductions(0, due({ sss: 10, philHealth: 0, pagIbig: 0, withholding: 0 }));
  assert.equal(zero.totalUncollected, 10);
  assert.equal(zero.appliedTotal, 0);
  const cent = allocateMandatoryDeductions(0.01, due({
    sss: 0.02, philHealth: 0, pagIbig: 0, withholding: 0,
  }));
  assert.equal(cent.appliedTotal, 0.01);
  assert.equal(cent.totalUncollected, 0.01);
  assert.equal(0.01 - cent.appliedTotal, 0);
});

test("negative or unsafe mandatory inputs fail closed", () => {
  assert.throws(() => allocateMandatoryDeductions(-1, due()), /Gross pay/);
  assert.throws(() => allocateMandatoryDeductions(100, due({ sss: -1 })), /cannot be negative/);
  assert.throws(() => allocateMandatoryDeductions(100, due({ sss: Number.NaN })), /finite/);
  assert.throws(() => allocateMandatoryDeductions(100, due({ philHealth: Infinity })), /finite/);
});

test("uncollected mandatory trace is an unwaivable blocker, including zero-gross employees", () => {
  for (const gross of [0, 100]) {
    const findings = evaluatePayrollAssurance([{
      id: 1, employeeId: 9,
      grossPay: gross, deductions: gross, netPay: 0, status: "Exception",
      lineItems: [{ code: "UNPAID_MANDATORY", label: "Uncollected", amount: "0.00" }],
      trace: { inputs: ["mandatoryUncollected=30.00"], flags: [] },
    }]);
    assert.ok(findings.findings.some((f) =>
      f.code === "MANDATORY_DEDUCTIONS_UNCOLLECTED"
      && f.blocking === true && f.severity === "high"
    ));
    assert.ok(findings.summary.blocking >= 1);
  }
  const invalid = evaluatePayrollAssurance([{
    id: 2, employeeId: 12, grossPay: 0, deductions: 0, netPay: 0, status: "Exception",
    trace: { inputs: ["mandatoryUncollected=invalid"], flags: [] },
  }]);
  assert.ok(invalid.findings.some((f) => f.code === "MANDATORY_DEDUCTIONS_UNCOLLECTED" && f.blocking));
});

test("payroll engine preserves uncollected line on the payslip, does not inflate gross", () => {
  const source = readFileSync("src/lib/payroll-engine.ts", "utf8");
  assert.ok(source.includes("allocateMandatoryDeductions(gross"));
  assert.ok(source.includes("mandatory.appliedTotal"));
  assert.ok(source.includes('item.code === "UNPAID_MANDATORY"'));
  assert.ok(source.includes("UNPAID MANDATORY DEDUCTIONS: PHP"));
  assert.ok(source.includes("mandatoryUncollected="));
  assert.ok(source.includes("PAYROLL_MANDATORY_SHORTFALL:"));
});
