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


test("incomplete, duplicated or forged shortfall traces cannot bypass release assurance", () => {
  const fakeEntry = (inputs: string[], options: {
    flags?: string[];
    marker?: boolean;
  } = {}) => ({
    id: 919, employeeId: 218, grossPay: 100,
    deductions: 20, netPay: 80, status: "Ready" as const,
    trace: { inputs, flags: options.flags ?? [] },
    lineItems: options.marker
      ? [{ code: "UNPAID_MANDATORY", label: "Uncollected", amount: "0.00" }]
      : [],
  });
  const samples = [
    fakeEntry(["mandatoryUncollected=-1.00"]),
    fakeEntry(["mandatoryUncollected=0.00", "mandatoryUncollected=20.00"]),
    fakeEntry(["mandatoryUncollected=garbage"]),
    fakeEntry(["mandatoryRequested=30.00", "mandatoryApplied=20.00", "mandatoryUncollected=0.00"]),
    fakeEntry(["mandatoryRequested=30.00", "mandatoryApplied=20.00"]),
    fakeEntry(["mandatoryRequested=20.00", "mandatoryApplied=20.00", "mandatoryUncollected=0.0001"]),
    fakeEntry([], { marker: true }),
    fakeEntry([], { flags: ["Mandatory/statutory and attendance deductions exceed gross pay by PHP 30.00"] }),
  ];
  for (const [index, entry] of samples.entries()) {
    const result = evaluatePayrollAssurance([entry]);
    assert.ok(result.findings.some(f =>
      f.code === "MANDATORY_DEDUCTIONS_UNCOLLECTED"
      && f.severity === "high" && f.blocking === true
    ), "Corrupt or incomplete liability evidence must fail closed in sample " + index);
  }

  const normal = evaluatePayrollAssurance([
    fakeEntry(["mandatoryRequested=20.00", "mandatoryApplied=20.00", "mandatoryUncollected=0.00"]),
    { ...fakeEntry(["mandatoryUncollected=0.00"]), id: 920, employeeId: 219 },
  ]);
  assert.equal(normal.findings.filter(f => f.code === "MANDATORY_DEDUCTIONS_UNCOLLECTED").length, 0,
    "A complete reconciled trace or older verified zero-shortfall trace must not invent a debt");
});

test("payroll release and checklist use unwaivable blocking assurance before acknowledgements", () => {
  const route = readFileSync("src/app/api/payroll-runs/[id]/release/route.ts", "utf8");
  const checklist = readFileSync("src/lib/payroll-release-checklist.ts", "utf8");
  const assuranceGate = route.indexOf("const blockingFindings = assuranceResult?.assurance.findings.filter");
  const exceptionAcknowledgement = route.indexOf("if (run.exceptions > 0 && !body.acknowledgeExceptions)");
  assert.ok(assuranceGate > 0 && exceptionAcknowledgement > assuranceGate,
    "Unwaivable assurance must precede optional acknowledgment");
  assert.ok(route.includes('finding.code === "MISSING_BANK_DETAILS"'));
  assert.ok(!route.includes('finding.code === "MANDATORY_DEDUCTIONS_UNCOLLECTED"'),
    "No blanket exception may bypass statutory shortfall findings");
  assert.ok(checklist.includes("const nonBankBlockers = blockers.filter"));
  assert.ok(checklist.includes("nonBankBlockers.length === 0"));
  assert.ok(checklist.includes("acknowledgeable: nonBankBlockers.length === 0"));
});


test("1,500 deterministic centavo stress cases reconcile even with partial refunds", () => {
  let seed = 0x4178b30d;
  const next = (max: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % (max + 1);
  };
  const fields: Array<keyof Parameters<typeof allocateMandatoryDeductions>[1]> =
    ["sss", "philHealth", "pagIbig", "withholding",
     "yearEndTaxAdjustment", "tardiness", "undertime"];
  const asCents = (number: number) => Math.round(number * 100);
  for (let i = 0; i < 1500; i++) {
    const gross = next(900000) / 100;
    const demands = due({
      sss: next(30000) / 100,
      philHealth: next(30000) / 100,
      pagIbig: next(30000) / 100,
      withholding: next(400000) / 100,
      yearEndTaxAdjustment: (i % 3 === 0 ? -1 : 1) * next(300000) / 100,
      tardiness: next(15000) / 100,
      undertime: next(15000) / 100,
    });
    const result = allocateMandatoryDeductions(gross, demands);
    assert.equal(asCents(result.requestedTotal),
      asCents(result.appliedTotal) + asCents(result.totalUncollected),
      "Requested != applied + uncollected in case " + i);
    assert.equal(asCents(gross),
      asCents(result.appliedTotal) + asCents(result.disposableBeforeOptional),
      "Gross != applied + disposable in case " + i);
    for (const field of fields) {
      assert.equal(asCents(demands[field]),
        asCents(result.applied[field]) + asCents(result.uncollected[field]),
        field + " must foot to the centavo in case " + i);
      assert.ok(result.uncollected[field] >= 0);
    }
    assert.ok(result.disposableBeforeOptional >= 0);
  }
});
