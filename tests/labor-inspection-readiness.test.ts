import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildLaborInspectionFindings, type InspectionInput } from "../src/lib/labor-inspection-readiness";

function baseInput(today = "2026-10-05"): InspectionInput {
  return {
    today,
    taxYear: Number(today.slice(0, 4)),
    startDate: "2026-01-01",
    endDate: today,
    employees: [{
      id: 1,
      employeeNo: "EMP-001",
      name: "Ana Reyes",
      title: "Payroll Associate",
      status: "Active",
      startDate: "2024-01-01",
      region: "III",
      mwe: false,
      basicRate: 30000,
      restDay: "Sunday",
    }],
    payProfiles: [{
      employeeId: 1,
      payBasis: "monthly",
      rateAmount: 30000,
      standardWorkDaysPerMonth: 22,
      standardHoursPerDay: 8,
    }],
    runs: [{
      id: 10,
      periodLabel: "Sep 16-30, 2026",
      periodStart: "2026-09-16",
      periodEnd: "2026-09-30",
      payDate: "2026-09-30",
      status: "Released",
      employeeCount: 1,
    }],
    entries: [{
      id: 100,
      payrollRunId: 10,
      employeeId: 1,
      grossPay: 15000,
      deductions: 2000,
      netPay: 13000,
      status: "Ready",
      lineItems: [{ code: "BASIC", label: "Basic pay", amount: "15000.00" }],
      trace: { inputs: ["punches=0"], flags: [] },
    }],
    payslipEntryIds: [],
    historicalEntries: [],
    remittanceBatches: [{
      id: 50,
      agency: "SSS",
      applicableMonth: "2026-08",
      dueDate: "2026-09-30",
      status: "open",
      expectedTotal: 5000,
      amountPaid: null,
    }],
    remittanceMembers: [],
    separations: [],
    leavePolicies: [{ leaveType: "Annual leave", annualDays: 15, payTreatment: "paid", active: true }],
  };
}

test("inspection readiness finds missing payslip, time evidence and overdue remittance without inventing wage exposure", () => {
  const result = buildLaborInspectionFindings(baseInput());
  assert.ok(result.findings.some((row) => row.ruleCode === "PAYSLIP_MISSING"));
  assert.ok(result.findings.some((row) => row.ruleCode === "TIME_RECORD_GAP"));
  const remittance = result.findings.find((row) => row.ruleCode === "STATUTORY_REMITTANCE_OVERDUE");
  assert.equal(remittance?.exposureAmount, 5000);
  assert.equal(remittance?.exposureConfidence, "recorded-liability");
  assert.equal(result.summary.recordedExposure, 5000);
  assert.equal(result.findings.some((row) => row.ruleCode === "WAGE_FLOOR_SCREEN"), false);
});

test("overdue final pay uses the stored net final pay as recorded-liability exposure", () => {
  const input = baseInput("2026-10-05");
  input.separations = [{
    id: 9,
    employeeId: 1,
    lastDay: "2026-08-01",
    finalPayDueDate: "2026-08-31",
    status: "approved",
    netFinalPay: 18250.50,
    coeIssued: false,
    releaseReference: null,
  }];
  const result = buildLaborInspectionFindings(input);
  const finding = result.findings.find((row) => row.ruleCode === "FINAL_PAY_OVERDUE");
  assert.equal(finding?.exposureAmount, 18250.50);
  assert.equal(finding?.exposureConfidence, "recorded-liability");
  assert.ok(result.findings.some((row) => row.ruleCode === "COE_EVIDENCE_MISSING"));
});

test("13th month screening appears only after December 24 and labels the amount as a screening estimate", () => {
  const before = baseInput("2026-12-23");
  before.entries[0].lineItems = [{ code: "BASIC", label: "Basic pay", amount: "120000.00" }];
  assert.equal(
    buildLaborInspectionFindings(before).findings.some((row) => row.ruleCode === "THIRTEENTH_MONTH_SCREEN"),
    false,
  );

  const after = baseInput("2026-12-24");
  after.entries[0].lineItems = [{ code: "BASIC", label: "Basic pay", amount: "120000.00" }];
  const result = buildLaborInspectionFindings(after);
  const finding = result.findings.find((row) => row.ruleCode === "THIRTEENTH_MONTH_SCREEN");
  assert.equal(finding?.exposureAmount, 10000);
  assert.equal(finding?.exposureConfidence, "screening-estimate");
  assert.match(finding?.detail ?? "", /Confirm rank-and-file coverage/);
});

test("paid leave policy with at least five days suppresses the SIL policy review", () => {
  const covered = buildLaborInspectionFindings(baseInput());
  assert.equal(covered.findings.some((row) => row.ruleCode === "SIL_POLICY_REVIEW"), false);

  const input = baseInput();
  input.leavePolicies = [{ leaveType: "Unpaid leave", annualDays: 10, payTreatment: "unpaid", active: true }];
  const result = buildLaborInspectionFindings(input);
  assert.ok(result.findings.some((row) => row.ruleCode === "SIL_POLICY_REVIEW"));
});

test("released final pay without a payment reference remains an inspection evidence gap", () => {
  const input = baseInput();
  input.separations = [{
    id: 11,
    employeeId: 1,
    lastDay: "2026-09-01",
    finalPayDueDate: "2026-10-01",
    status: "released",
    netFinalPay: 9000,
    coeIssued: true,
    releaseReference: null,
  }];
  const result = buildLaborInspectionFindings(input);
  assert.ok(result.findings.some((row) => row.ruleCode === "FINAL_PAY_RELEASE_REFERENCE_MISSING"));
  assert.equal(result.findings.some((row) => row.ruleCode === "FINAL_PAY_OVERDUE"), false);
});

test("inspection API requires company-wide role, fresh evidence and MFA-protected close-out", () => {
  const route = readFileSync("src/app/api/compliance/labor-inspection/route.ts", "utf8");
  assert.ok(route.includes("company-wide"));
  assert.ok(route.includes("buildLaborInspectionReadiness"));
  assert.ok(route.includes("This finding is still detected"));
  assert.ok(route.includes("requireSensitiveActionMfa"));
  assert.ok(route.includes('verification: "finding-no-longer-detected"'));
  assert.ok(route.includes("recordAuditEvent"));
});

test("remediation schema is additive in migration, baseline and compatibility upgrade", () => {
  for (const path of [
    "drizzle/0024_labor_inspection_readiness.sql",
    "drizzle/baseline.sql",
    "src/lib/core-schema-compat.ts",
    "src/db/schema.ts",
  ]) {
    assert.ok(readFileSync(path, "utf8").includes("labor_inspection_remediations"), path);
  }
});

test("Compliance Center renders the inspection readiness panel", () => {
  const panels = readFileSync("src/components/workspace/panels.tsx", "utf8");
  const ui = readFileSync("src/components/workspace/labor-inspection-readiness-panel.tsx", "utf8");
  assert.ok(panels.includes("LaborInspectionReadinessPanel"));
  assert.ok(ui.includes("Show the evidence before an inspector asks for it."));
  assert.ok(ui.includes("Recorded exposure"));
  assert.ok(ui.includes("Close with evidence"));
  assert.ok(ui.includes("This is an inspection-readiness control, not a DOLE certification."));
});


test("unmapped region fails closed instead of borrowing NCR wage rates", () => {
  const input = baseInput();
  input.employees[0].region = "UNKNOWN";
  const result = buildLaborInspectionFindings(input);
  assert.ok(result.findings.some((row) => row.ruleCode === "WAGE_REGION_UNMAPPED"));
  assert.equal(result.findings.some((row) => row.ruleCode === "WAGE_FLOOR_SCREEN"), false);
});


test("missing imported basic salary blocks a false-complete 13th-month screen", () => {
  const input = baseInput("2026-12-24");
  input.entries[0].lineItems = [{ code: "BASIC", label: "Basic pay", amount: "120000.00" }];
  input.historicalEntries = [{
    employeeId: 1,
    payDate: "2026-03-31",
    basicSalary: null,
    thirteenthMonth: 0,
  }];
  const result = buildLaborInspectionFindings(input);
  assert.ok(result.findings.some((row) => row.ruleCode === "HISTORICAL_BASIC_MISSING"));
  assert.equal(result.findings.some((row) => row.ruleCode === "THIRTEENTH_MONTH_SCREEN"), false);
});
