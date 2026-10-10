import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { evaluateBirAnnualReadiness, type BirAnnualReadinessInput } from "../src/lib/bir-annual-readiness";

const employee = {
  employeeId: 11,
  employeeNo: "EMP-011",
  tin: "123456789",
  tinBranchCode: "0000",
  firstName: "Ana",
  lastName: "Santos",
  mwe: false,
  grossCompensation: "600000.00",
  nonTaxable: "75000.00",
  taxableIncome: "525000.00",
  taxDue: "47500.00",
  taxWithheld: "60000.00",
  adjustment: "-12500.00",
  outcome: "refund",
  status: "settled",
};

const valid: BirAnnualReadinessInput = {
  taxYear: 2026,
  employerTin: "987654321",
  employerBranchCode: "0000",
  legalEmployerCount: 1,
  rows: [employee],
  payrollEmployeeIds: [11],
  releasedPayrollRunCount: 24,
  payrollMonths: ["2026-01"],
  bir1601cMonths: [{ month: "2026-01", reconciled: true }],
};

const codes = (report: ReturnType<typeof evaluateBirAnnualReadiness>) =>
  report.blockers.map((item) => item.code);

test("valid 1604-C source passes local checks but never claims BIR filing readiness", () => {
  const report = evaluateBirAnnualReadiness(valid);
  assert.equal(report.canExportSource, true);
  assert.equal(report.filingReady, false);
  assert.equal(report.outputType, "source-csv-not-bir-dat");
  assert.equal(report.summary.annualGrossCompensation, "600000.00");
  assert.equal(report.summary.annualTaxDue, "47500.00");
  assert.deepEqual(report.blockers, []);
});

test("missing legal employer registration cannot be silently guessed or padded", () => {
  const report = evaluateBirAnnualReadiness({ ...valid, employerTin: "123456789", employerBranchCode: null });
  assert.ok(codes(report).includes("EMPLOYER_BIR_ID"));
  assert.equal(report.canExportSource, false);
});

test("organizations with multiple legal employers cannot reuse organization-wide year end", () => {
  const report = evaluateBirAnnualReadiness({ ...valid, legalEmployerCount: 2 });
  assert.ok(codes(report).includes("LEGAL_EMPLOYER_SCOPE"));
  assert.equal(report.canExportSource, false);
});

test("year end blocks duplicate TINs, missing names and unknown payroll employees", () => {
  const report = evaluateBirAnnualReadiness({
    ...valid,
    payrollEmployeeIds: [11, 12, 99],
    rows: [
      employee,
      { ...employee, employeeId: 12, employeeNo: "EMP-012", firstName: "", lastName: "" },
    ],
  });
  assert.ok(codes(report).includes("DUPLICATE_EMPLOYEE_TIN"));
  assert.ok(codes(report).includes("EMPLOYEE_NAME"));
  assert.ok(codes(report).includes("MISSING_ANNUAL_EMPLOYEE"));
});

test("year end blocks a bad taxable split and inconsistent withholding adjustment", () => {
  const report = evaluateBirAnnualReadiness({
    ...valid,
    rows: [{
      ...employee,
      taxableIncome: "525100.00",
      adjustment: "-12501.00",
      outcome: "refund",
    }],
  });
  assert.ok(codes(report).includes("ANNUAL_TAXABLE_SPLIT"));
  assert.ok(codes(report).includes("YEAR_END_TAX_VARIANCE"));
});

test("unsettled year end refunds cannot be treated as final source values", () => {
  const report = evaluateBirAnnualReadiness({
    ...valid,
    rows: [{ ...employee, status: "approved" }],
  });
  assert.ok(codes(report).includes("ADJUSTMENT_UNSETTLED"));
});

test("MWE taxable split is not falsely required to equal gross minus ordinary exemptions", () => {
  const report = evaluateBirAnnualReadiness({
    ...valid,
    rows: [{
      ...employee, mwe: true,
      grossCompensation: "240000.00",
      nonTaxable: "23000.00",
      taxableIncome: "5000.00",
      taxDue: "0.00",
      taxWithheld: "0.00",
      adjustment: "0.00",
      outcome: "balanced",
      status: "settled",
    }],
  });
  assert.ok(!codes(report).includes("ANNUAL_TAXABLE_SPLIT"));
  assert.equal(report.canExportSource, true);
});

test("monthly 1601-C reconciliation and imported history remain explicit review warnings", () => {
  const report = evaluateBirAnnualReadiness({
    ...valid,
    importedHistoryCount: 4,
    payrollMonths: ["2026-01", "2026-02"],
    bir1601cMonths: [{ month: "2026-01", reconciled: false }],
  });
  const warningCodes = report.warnings.map((item) => item.code);
  assert.ok(warningCodes.includes("MONTHLY_1601C_NOT_RECONCILED"));
  assert.ok(warningCodes.includes("IMPORTED_HISTORY_REVIEW"));
  assert.equal(report.filingReady, false);
});

test("2316 is never generated for an unspecified or arbitrary employee", () => {
  const route = readFileSync("src/app/api/year-end/route.ts", "utf8");
  assert.ok(route.includes('format === "preflight"'));
  assert.ok(route.includes('requireSensitiveActionMfa(user)'));
  assert.ok(route.includes("employeeId is required to select the exact Form 2316 employee."));
  assert.ok(route.includes("const match = rows.find((row) => row.employee.id === employeeId);"));
  assert.ok(!route.includes("?? rows[0]"));
});

test("annual CSV has a real first header row and is never promoted to BIR .DAT", () => {
  const route = readFileSync("src/app/api/year-end/route.ts", "utf8");
  assert.ok(route.includes('return new Response(csv,'));
  assert.ok(route.includes('"X-PayrollPH-Filing-Status": "DRAFT-SOURCE-NOT-BIR-DAT"'));
  assert.ok(route.includes('if (!readiness?.canExportSource)'));
  const workspace = readFileSync("src/components/workspace/panels.tsx", "utf8");
  assert.ok(workspace.includes('data-bir-annual-preflight'));
  assert.ok(workspace.includes("birPreflight?.canExportSource"));
});

test("annual source distinguishes pre-settlement and expected final withholding", () => {
  const route = readFileSync("src/app/api/year-end/route.ts", "utf8");
  assert.ok(route.includes('"Tax Withheld Before Year-End Settlement"'));
  assert.ok(route.includes('"Expected Tax Withheld After Settlement"'));
  assert.ok(route.includes("Number(row.adjustment.taxWithheld) + Number(row.adjustment.adjustment)"));
});
