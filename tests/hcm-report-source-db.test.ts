import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  employees, organizations, orgUnits, payrollEntries, payrollRuns,
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
    const [unitA, unitB] = await db.insert(orgUnits).values([
      { organizationId: a.id, type: "department", code: "RPTA", name: "Operations" },
      { organizationId: b.id, type: "department", code: "RPTB", name: "Finance" },
    ]).returning({ id: orgUnits.id });
    const [workerA, workerB] = await db.insert(employees).values([
      {
        organizationId: a.id, orgUnitId: unitA.id, employeeNo: "RPT-A",
        firstName: "Sample", lastName: "One", title: "Tester",
        avatarInitials: "SO", basicRate: "20000.00", startDate: "2026-01-01",
      },
      {
        organizationId: b.id, orgUnitId: unitB.id, employeeNo: "RPT-B",
        firstName: "Sample", lastName: "Two", title: "Tester",
        avatarInitials: "ST", basicRate: "30000.00", startDate: "2026-01-01",
      },
    ]).returning({ id: employees.id });
    const [runA, runB] = await db.insert(payrollRuns).values([
      {
        organizationId: a.id, scopeOrgUnitId: unitA.id, periodLabel: "October first",
        periodStart: "2026-10-01", periodEnd: "2026-10-15", payDate: "2026-10-15", status: "Released",
      },
      {
        organizationId: b.id, scopeOrgUnitId: unitB.id, periodLabel: "October first",
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
