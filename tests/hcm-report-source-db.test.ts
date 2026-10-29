import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  employees, legalEntities, organizations, orgUnits, payrollEntries, payrollRuns,
  leaveRequests, overtimeRequests,
} from "../src/db/schema";
import { loadAuthorizedReportRows, overtimeCostFromPayLines } from "../src/lib/hcm-report-source";
import { validateReportDates } from "../src/lib/hcm-report-builder";

test("report date windows reject invalid calendar dates and excessive periods", () => {
  assert.doesNotThrow(() => validateReportDates("2026-10-01", "2026-10-31"));
  assert.throws(() => validateReportDates("2026-02-30", "2026-03-01"), /valid YYYY-MM-DD/);
  assert.throws(() => validateReportDates("2025-01-01", "2026-10-31"), /1-366 days/);
});
test("overtime cost reads statutory OT and configured overtime premium only", () => {
  assert.equal(overtimeCostFromPayLines([
    { code: "OT", amount: "125.25" }, { code: "OTPREM-19", amount: "15.50" },
    { code: "BASIC", amount: "1000.00" }, { code: "HOLIDAY", amount: "100.00" },
  ]), 140.75);
  assert.throws(() => overtimeCostFromPayLines([{ code: "OT", amount: "NaN" }]), /invalid amount/);
});

test("report source is tenant-isolated and rejects unscoped payroll attribution", async () => {
  const orgIds: number[] = [];
  try {
    const [a, b] = await db.insert(organizations).values([
      { name: "HCM Report Test A", legalName: "HCM Report Test A" },
      { name: "HCM Report Test B", legalName: "HCM Report Test B" },
    ]).returning({ id: organizations.id });
    orgIds.push(a.id, b.id);
    const [entityA, entityB] = await db.insert(legalEntities).values([
      { organizationId: a.id, code: "HCM-RPT-A", legalName: "Fictional Report Entity A",
        displayName: "Fictional Report A", primaryEntity: true },
      { organizationId: b.id, code: "HCM-RPT-B", legalName: "Fictional Report Entity B",
        displayName: "Fictional Report B", primaryEntity: true },
    ]).returning({ id: legalEntities.id });
    const [unitA, unitB] = await db.insert(orgUnits).values([
      { organizationId: a.id, legalEntityId: entityA.id,
        type: "department", code: "RPTA", name: "Operations" },
      { organizationId: b.id, legalEntityId: entityB.id,
        type: "department", code: "RPTB", name: "Finance" },
    ]).returning({ id: orgUnits.id });
    const [workerA, workerB] = await db.insert(employees).values([
      {
        organizationId: a.id, legalEntityId: entityA.id,
        orgUnitId: unitA.id, employeeNo: "RPT-A",
        firstName: "Sample", lastName: "One", title: "Tester",
        avatarInitials: "SO", basicRate: "20000.00", startDate: "2026-01-01",
      },
      {
        organizationId: b.id, legalEntityId: entityB.id,
        orgUnitId: unitB.id, employeeNo: "RPT-B",
        firstName: "Sample", lastName: "Two", title: "Tester",
        avatarInitials: "ST", basicRate: "30000.00", startDate: "2026-01-01",
      },
    ]).returning({ id: employees.id });
    const [runA, runB] = await db.insert(payrollRuns).values([
      {
        organizationId: a.id, legalEntityId: entityA.id,
        scopeOrgUnitId: unitA.id, periodLabel: "October first",
        periodStart: "2026-10-01", periodEnd: "2026-10-15", payDate: "2026-10-15", status: "Released",
      },
      {
        organizationId: b.id, legalEntityId: entityB.id,
        scopeOrgUnitId: unitB.id, periodLabel: "October first",
        periodStart: "2026-10-01", periodEnd: "2026-10-15", payDate: "2026-10-15", status: "Released",
      },
    ]).returning({ id: payrollRuns.id });
    await db.insert(payrollEntries).values([
      { payrollRunId: runA.id, employeeId: workerA.id, grossPay: "6000.00", deductions: "500.00", netPay: "5500.00", lineItems: [{ code: "OT", amount: "500.00" }] },
      { payrollRunId: runB.id, employeeId: workerB.id, grossPay: "9999.00", deductions: "500.00", netPay: "9499.00", lineItems: [{ code: "OT", amount: "999.00" }] },
    ]);
    await db.insert(leaveRequests).values([
      { organizationId: a.id, employeeId: workerA.id, leaveType: "Vacation", startDate: "2026-10-08", endDate: "2026-10-08", days: "1.0", status: "Approved" },
      { organizationId: b.id, employeeId: workerB.id, leaveType: "Vacation", startDate: "2026-10-08", endDate: "2026-10-08", days: "3.0", status: "Approved" },
    ]);
    await db.insert(overtimeRequests).values([
      { organizationId: a.id, employeeId: workerA.id, workDate: "2026-10-06", requestedMinutes: 120, reason: "Coverage", requestedBy: "Tester", status: "approved" },
      { organizationId: b.id, employeeId: workerB.id, workDate: "2026-10-06", requestedMinutes: 60, reason: "Coverage", requestedBy: "Tester", status: "approved" },
    ]);

    const range = { startDate: "2026-10-01", endDate: "2026-10-31" };
    const payroll = await loadAuthorizedReportRows({ organizationId: a.id, dataset: "payroll", ...range });
    assert.deepEqual(payroll, [{ department: "Operations", grossPay: 6000, overtimeCost: 500 }]);

    // Malformed legacy rows can link a run owned by A to a worker from B.
    // With only the payroll-run join, that foreign worker's wages were included
    // in A's report. The new employee join must reject the entire report.
    const [foreignEntry] = await db.insert(payrollEntries).values({
      payrollRunId: runA.id, employeeId: workerB.id,
      grossPay: "99000.00", deductions: "1000.00", netPay: "98000.00",
      lineItems: [{ code: "OT", amount: "9999.00" }],
    }).returning({ id: payrollEntries.id });
    await assert.rejects(
      () => loadAuthorizedReportRows({ organizationId: a.id, dataset: "payroll", ...range }),
      /source attribution/,
    );
    await db.delete(payrollEntries).where(eq(payrollEntries.id, foreignEntry.id));
    assert.deepEqual(
      await loadAuthorizedReportRows({ organizationId: a.id, dataset: "payroll", ...range }),
      payroll, "original own-employer rows still work after foreign entry is removed",
    );

    // The database has a reviewed tenant/employer composite FK. We must NOT
    // disable that protection just to test legacy corruption: a worker from A
    // may never be assigned directly to company B's employer.
    await assert.rejects(
      () => db.update(employees).set({ legalEntityId: entityB.id })
        .where(eq(employees.id, workerA.id)),
      /employees_tenant_employer_fk|foreign key constraint/,
      "Real PostgreSQL tenant/employer FK must reject a cross-company reference",
    );

    // A second legal employer belonging to A is valid under that FK but
    // inconsistent with A's released run, which uses entityA. The report
    // loader must reject the mismatched pay source instead of adding wages.
    const [otherEntityA] = await db.insert(legalEntities).values({
      organizationId: a.id, code: "HCM-RPT-A-SECOND",
      legalName: "Fictional second employer within A",
      displayName: "Fictional Second Entity A",
    }).returning({ id: legalEntities.id });
    await db.update(employees).set({ legalEntityId: otherEntityA.id })
      .where(eq(employees.id, workerA.id));
    await assert.rejects(
      () => loadAuthorizedReportRows({ organizationId: a.id, dataset: "payroll", ...range }),
      /source attribution/,
      "Real employee/run employer disagreement must fail closed",
    );

    // Missing historical employer attribution is not the same as verified
    // membership of the current company. Keep the report unavailable.
    await db.update(employees).set({ legalEntityId: null })
      .where(eq(employees.id, workerA.id));
    await assert.rejects(
      () => loadAuthorizedReportRows({ organizationId: a.id, dataset: "payroll", ...range }),
      /source attribution/,
      "An unattributed worker in released payroll must fail closed",
    );
    await db.update(employees).set({ legalEntityId: entityA.id })
      .where(eq(employees.id, workerA.id));
    assert.deepEqual(
      await loadAuthorizedReportRows({ organizationId: a.id, dataset: "payroll", ...range }),
      payroll, "own payroll results recover after legal-employer attribution is restored",
    );
    const time = await loadAuthorizedReportRows({ organizationId: a.id, dataset: "time", ...range });
    assert.equal(time.length, 2);
    assert.equal(time.reduce((sum, row) => sum + Number(row.absenceDays), 0), 1);
    assert.equal(time.reduce((sum, row) => sum + Number(row.overtimeHours), 0), 2);
    const people = await loadAuthorizedReportRows({ organizationId: a.id, dataset: "people", ...range });
    assert.equal(people.length, 1);
    assert.equal(people[0]?.department, "Operations");
    await db.update(payrollRuns).set({ scopeOrgUnitId: null }).where(eq(payrollRuns.id, runA.id));
    await assert.rejects(
      () => loadAuthorizedReportRows({ organizationId: a.id, dataset: "payroll", ...range }),
      /historical department attribution/,
    );
    const totalsOnly = await loadAuthorizedReportRows({
      organizationId: a.id, dataset: "payroll", ...range,
      requireDepartmentAttribution: false,
    });
    assert.deepEqual(totalsOnly, [
      { department: "Unattributed", grossPay: 6000, overtimeCost: 500 },
    ]);
  } finally {
    for (const id of orgIds) await db.delete(organizations).where(eq(organizations.id, id));
  }
});
