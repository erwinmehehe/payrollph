import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildDoleThirteenthMonthReport } from "../src/lib/dole-thirteenth-month-report";

const profile = {
  establishmentAddress: "Angeles City, Pampanga",
  principalBusiness: "Software",
  contactName: "Payroll Lead",
  contactPosition: "Finance Manager",
  contactPhone: "09171234567",
};

test("DOLE report summarizes actual recorded 13th-month grants and official report fields", () => {
  const result = buildDoleThirteenthMonthReport({
    taxYear: 2026,
    establishmentName: "Acme Payroll Inc.",
    profile,
    workers: [
      {
        employeeId: 1,
        employeeNo: "EMP-001",
        employeeName: "Ana Reyes",
        basicSalaryEarned: 240000,
        payrollThirteenthPaid: 18000,
        historicalThirteenthPaid: 0,
        finalPayThirteenthPaid: 2000,
        basicSalaryComplete: true,
      },
      {
        employeeId: 2,
        employeeNo: "EMP-002",
        employeeName: "Ben Cruz",
        basicSalaryEarned: 120000,
        payrollThirteenthPaid: 10000,
        historicalThirteenthPaid: 0,
        finalPayThirteenthPaid: 0,
        basicSalaryComplete: true,
      },
    ],
  });

  assert.equal(result.report.dueDate, "2027-01-15");
  assert.equal(result.report.totalEmployment, 2);
  assert.equal(result.report.workersBenefited, 2);
  assert.equal(result.report.totalBenefitsGranted, 30000);
  assert.equal(result.report.employees[0]?.amountGranted, 20000);
  assert.equal(result.profileComplete, true);
  assert.equal(result.readyToSubmit, true);
  assert.match(result.reportHash, /^[a-f0-9]{64}$/);
});

test("released final-pay 13th month participates in the amount granted", () => {
  const result = buildDoleThirteenthMonthReport({
    taxYear: 2026,
    establishmentName: "Acme Payroll Inc.",
    profile,
    workers: [{
      employeeId: 7,
      employeeNo: "EMP-007",
      employeeName: "Cara Santos",
      basicSalaryEarned: 120000,
      payrollThirteenthPaid: 7000,
      historicalThirteenthPaid: 1000,
      finalPayThirteenthPaid: 2000,
      basicSalaryComplete: true,
    }],
  });
  assert.equal(result.report.employees[0]?.amountGranted, 10000);
  assert.equal(result.reviewRows.length, 0);
});

test("1/12 shortfall is review-only and incomplete historical basic never invents an entitlement", () => {
  const result = buildDoleThirteenthMonthReport({
    taxYear: 2026,
    establishmentName: "Acme Payroll Inc.",
    profile,
    workers: [
      {
        employeeId: 1,
        employeeNo: "EMP-001",
        employeeName: "Ana Reyes",
        basicSalaryEarned: 240000,
        payrollThirteenthPaid: 15000,
        historicalThirteenthPaid: 0,
        finalPayThirteenthPaid: 0,
        basicSalaryComplete: true,
      },
      {
        employeeId: 2,
        employeeNo: "EMP-002",
        employeeName: "Ben Cruz",
        basicSalaryEarned: 0,
        payrollThirteenthPaid: 5000,
        historicalThirteenthPaid: 0,
        finalPayThirteenthPaid: 0,
        basicSalaryComplete: false,
      },
    ],
  });
  assert.equal(result.reviewRows[0]?.screeningShortfall, 5000);
  assert.equal(result.incompleteBasicRows.length, 1);
  assert.equal(result.incompleteBasicRows[0]?.employeeNo, "EMP-002");
});

test("missing establishment reporting profile blocks submission readiness but not report calculation", () => {
  const result = buildDoleThirteenthMonthReport({
    taxYear: 2026,
    establishmentName: "Acme Payroll Inc.",
    profile: null,
    workers: [{
      employeeId: 1,
      employeeNo: "EMP-001",
      employeeName: "Ana Reyes",
      basicSalaryEarned: 120000,
      payrollThirteenthPaid: 10000,
      historicalThirteenthPaid: 0,
      finalPayThirteenthPaid: 0,
      basicSalaryComplete: true,
    }],
  });
  assert.equal(result.profileComplete, false);
  assert.equal(result.readyToSubmit, false);
  assert.equal(result.report.totalBenefitsGranted, 10000);
});

test("report hash changes when amounts or reporting profile changes", () => {
  const base = buildDoleThirteenthMonthReport({
    taxYear: 2026,
    establishmentName: "Acme Payroll Inc.",
    profile,
    workers: [{
      employeeId: 1,
      employeeNo: "EMP-001",
      employeeName: "Ana Reyes",
      basicSalaryEarned: 120000,
      payrollThirteenthPaid: 10000,
      historicalThirteenthPaid: 0,
      finalPayThirteenthPaid: 0,
      basicSalaryComplete: true,
    }],
  });
  const changed = buildDoleThirteenthMonthReport({
    taxYear: 2026,
    establishmentName: "Acme Payroll Inc.",
    profile: { ...profile, contactPhone: "09170000000" },
    workers: [{
      employeeId: 1,
      employeeNo: "EMP-001",
      employeeName: "Ana Reyes",
      basicSalaryEarned: 120000,
      payrollThirteenthPaid: 10001,
      historicalThirteenthPaid: 0,
      finalPayThirteenthPaid: 0,
      basicSalaryComplete: true,
    }],
  });
  assert.notEqual(base.reportHash, changed.reportHash);
});

test("server sources released payroll, imported history and released final pay", () => {
  const server = readFileSync("src/lib/dole-thirteenth-month-report-server.ts", "utf8");
  assert.ok(server.includes('eq(payrollRuns.status, "Released")'));
  assert.ok(server.includes("historicalPayrollEntries"));
  assert.ok(server.includes('eq(separationRecords.status, "released")'));
  assert.ok(server.includes("row.prorated13thMonth"));
  assert.ok(server.includes("row.basicSalaryEarnedYtd"));
  assert.ok(server.includes("legacyHistoryMissingBasic"));
});

test("DOLE route generates a source worksheet but never claims to submit it", () => {
  const route = readFileSync("src/app/api/compliance/dole-13th-month/route.ts", "utf8");
  assert.ok(route.includes("DOLE 13th-month source worksheet generated"));
  assert.ok(route.includes("source worksheet, not an OCP upload template"));
  assert.ok(route.includes("portalSubmissionPerformedByPayrollPH: false"));
  assert.ok(route.includes("record_submission"));
  assert.ok(route.includes("requireSensitiveActionMfa(user)"));
  assert.ok(route.includes("reportHash: state.reportHash"));
  assert.ok(route.includes("DOLE 13th-month portal submission recorded"));
});

test("DOLE reporting profile and submission evidence are additive and self-initializing", () => {
  for (const path of [
    "drizzle/0032_dole_13th_month_reporting.sql",
    "drizzle/baseline.sql",
    "src/db/schema.ts",
    "src/lib/dole-reporting-schema.ts",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.ok(source.includes("dole_reporting_profiles"), path);
    assert.ok(source.includes("dole_compliance_submissions"), path);
  }
  const guard = readFileSync("src/lib/dole-reporting-schema.ts", "utf8");
  assert.ok(guard.includes("pg_advisory_xact_lock"));
});

test("Compliance Center exposes report summary, source download, OCP link and stale evidence warning", () => {
  const panels = readFileSync("src/components/workspace/panels.tsx", "utf8");
  const ui = readFileSync("src/components/workspace/dole-thirteenth-month-report-panel.tsx", "utf8");
  assert.ok(panels.includes("DoleThirteenthMonthReportPanel"));
  assert.ok(ui.includes("Prepare the annual report, then preserve the portal proof."));
  assert.ok(ui.includes("Download source worksheet"));
  assert.ok(ui.includes("Open DOLE Online Compliance Portal"));
  assert.ok(ui.includes("Previous submission evidence is stale."));
  assert.ok(ui.includes("Record OCP submission"));
});
