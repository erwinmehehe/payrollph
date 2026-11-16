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

test("DOLE reporting profile and submission evidence are additive and checked, never created at request time", () => {
  for (const path of [
    "drizzle/0032_dole_13th_month_reporting.sql",
    "drizzle/baseline.sql",
    "src/db/schema.ts",
    "src/lib/request-schema-readonly.ts",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.ok(source.includes("dole_reporting_profiles"), path);
    assert.ok(source.includes("dole_compliance_submissions"), path);
  }
  const guard = readFileSync("src/lib/dole-reporting-schema.ts", "utf8");
  assert.ok(guard.includes("cachedRequestSchemaVerifier(pool, doleReportingSchemaSpec)"));
  assert.ok(!/CREATE\s+TABLE|ALTER\s+TABLE|pg_advisory_xact_lock/i.test(guard), "no request-time DDL remains");
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

const roundingProfile = {
  establishmentAddress: "Angeles City, Pampanga", principalBusiness: "Software",
  contactName: "Payroll Lead", contactPosition: "Finance Manager", contactPhone: "09171234567",
};
const oneWorker = (basicSalaryEarned: number, payrollThirteenthPaid: number) => buildDoleThirteenthMonthReport({
  taxYear: 2026, establishmentName: "Acme", profile: roundingProfile,
  workers: [{ employeeId: 1, employeeNo: "E1", employeeName: "A", basicSalaryEarned, payrollThirteenthPaid,
    historicalThirteenthPaid: 0, finalPayThirteenthPaid: 0, basicSalaryComplete: true }],
});

test("screening entitlement uses exact centavo half-up (basic 100.02 -> 8.34, not the old float 8.33)", () => {
  // 10,002 centavos / 12 = 833.5 -> 834. Granted 8.33 leaves a real 0.01 shortfall the old float path hid.
  const result = oneWorker(100.02, 8.33);
  assert.equal(result.reviewRows.length, 1);
  assert.equal(result.reviewRows[0]?.screeningEntitlement, 8.34);
  assert.equal(result.reviewRows[0]?.screeningShortfall, 0.01);
  // Granted exactly the exact entitlement: no shortfall.
  assert.equal(oneWorker(100.02, 8.34).reviewRows.length, 0);
});

test("screening entitlement: whole-peso cases unchanged, unverified basic stays diagnostic only", () => {
  const whole = oneWorker(120000, 0);
  assert.equal(whole.reviewRows[0]?.screeningEntitlement, 10000);
  assert.equal(whole.readyToSubmit, true);
  // Sub-centavo basic cannot be verified: preserve the old displayed estimate
  // but never claim that the shortfall is verified or submission-ready.
  const subcent = oneWorker(100.0049, 0);
  assert.equal(subcent.workers[0]?.screeningEntitlement, 8.33);
  assert.equal(subcent.workers[0]?.screeningShortfall, null);
  assert.equal(subcent.workers[0]?.screeningBasicVerified, false);
  assert.equal(subcent.reviewRows.length, 0);
  assert.equal(subcent.incompleteBasicRows[0]?.employeeNo, "E1");
  assert.equal(subcent.readyToSubmit, false);
  // The existing negative-basic floor is unchanged.
  assert.equal(oneWorker(-500, 0).reviewRows.length, 0);
});

test("invalid, unsupported, and non-finite basic amounts cannot silently clear a DOLE screen", () => {
  for (const basic of [100.015, 100.0049, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER, "100.02" as unknown as number]) {
    const report = oneWorker(basic, 8.33);
    assert.equal(report.workers[0]?.basicSalaryComplete, false, String(basic));
    assert.equal(report.workers[0]?.screeningBasicVerified, false, String(basic));
    assert.equal(report.workers[0]?.screeningShortfall, null, String(basic));
    assert.equal(report.reviewRows.length, 0, String(basic));
    assert.deepEqual(report.incompleteBasicRows.map(row => row.employeeNo), ["E1"], String(basic));
    assert.equal(report.readyToSubmit, false, String(basic));
    assert.equal(report.report.employees[0]?.amountGranted, 8.33, String(basic));
    assert.equal(report.report.totalBenefitsGranted, 8.33, String(basic));
    if (typeof basic !== "number" || !Number.isFinite(basic)) {
      assert.equal(report.workers[0]?.screeningEntitlement, null, String(basic));
    }
  }
});

test("a one-centavo rounding correction never alters reported grants, totals, or report hash", () => {
  const before = oneWorker(100.00, 8.33); // 100.00 / 12 was and is 8.33.
  const after = oneWorker(100.02, 8.33);  // Exact result is 8.34, so screen 0.01 short.
  assert.equal(before.reviewRows.length, 0);
  assert.equal(after.reviewRows.length, 1);
  assert.equal(after.reviewRows[0]?.screeningShortfall, 0.01);
  assert.equal(after.workers[0]?.screeningBasicVerified, true);
  assert.equal(after.incompleteBasicRows.length, 0);
  assert.equal(after.readyToSubmit, true);
  // These constitute the DOLE payload. The basic salary is NOT part of it.
  assert.deepEqual(after.report, before.report);
  assert.equal(after.report.totalBenefitsGranted, 8.33);
  assert.equal(after.report.workersBenefited, 1);
  assert.deepEqual(after.report.employees, [{ employeeNo: "E1", employeeName: "A", amountGranted: 8.33 }]);
  assert.equal(after.reportHash, before.reportHash);
});
