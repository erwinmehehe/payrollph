import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  employees, legalEntities, organizations, orgUnits, payrollEntries,
  payrollRuns, workforceTimesheets,
} from "../src/db/schema";
import { runBiExport, type BiExportKey } from "../src/lib/bi-exports";

const FILTERS = { startDate: "2026-10-01", endDate: "2026-10-31" };
const TENANT_SOURCE_MISMATCH = /BI_EXPORT_TENANT_SOURCE_MISMATCH/;

test("BI payroll and workforce exports reject inconsistent cross-tenant source links", async () => {
  // Only synthetic records in the disposable CI PostgreSQL service. The
  // legacy BI endpoint remains gated; this tests its source query directly.
  const orgIds: number[] = [];
  try {
    const [a, b] = await db.insert(organizations).values([
      { name: "Fictional BI Source A", legalName: "Fictional BI Source Employer A" },
      { name: "Fictional BI Source B", legalName: "Fictional BI Source Employer B" },
    ]).returning({ id: organizations.id });
    orgIds.push(a.id, b.id);

    const [entityA, entityB] = await db.insert(legalEntities).values([
      { organizationId: a.id, code: "BI-A", legalName: "Fictional Entity A",
        displayName: "Fictional Entity A", primaryEntity: true },
      { organizationId: b.id, code: "BI-B", legalName: "Fictional Entity B",
        displayName: "Fictional Entity B", primaryEntity: true },
    ]).returning({ id: legalEntities.id });
    const [unitA, unitB] = await db.insert(orgUnits).values([
      { organizationId: a.id, legalEntityId: entityA.id,
        type: "department", name: "Employer A unit", code: "BI-UNIT-A" },
      { organizationId: b.id, legalEntityId: entityB.id,
        type: "department", name: "Employer B unit", code: "BI-UNIT-B" },
    ]).returning({ id: orgUnits.id });
    const [workerA, workerB] = await db.insert(employees).values([
      { organizationId: a.id, legalEntityId: entityA.id, orgUnitId: unitA.id,
        employeeNo: "BIA-01", firstName: "Fictional", lastName: "WorkerA",
        title: "Tester", avatarInitials: "FA", basicRate: "15000.00",
        startDate: "2026-01-01" },
      { organizationId: b.id, legalEntityId: entityB.id, orgUnitId: unitB.id,
        employeeNo: "BIB-01", firstName: "Fictional", lastName: "WorkerB",
        title: "Tester", avatarInitials: "FB", basicRate: "99000.00",
        startDate: "2026-01-01" },
    ]).returning({ id: employees.id });
    const [runA] = await db.insert(payrollRuns).values({
      organizationId: a.id, legalEntityId: entityA.id, scopeOrgUnitId: unitA.id,
      periodLabel: "October fictional cutoff",
      periodStart: "2026-10-01", periodEnd: "2026-10-15",
      payDate: "2026-10-15", status: "Released",
    }).returning({ id: payrollRuns.id });
    await db.insert(payrollEntries).values({
      payrollRunId: runA.id, employeeId: workerA.id,
      grossPay: "6500.00", deductions: "500.00", netPay: "6000.00",
      lineItems: [{ code: "BASIC", amount: "6500.00" }],
    });
    await db.insert(workforceTimesheets).values({
      organizationId: a.id, employeeId: workerA.id,
      periodStart: "2026-10-01", periodEnd: "2026-10-15",
      snapshotHash: "a".repeat(64), status: "approved",
    });

    const exported = (key: BiExportKey) =>
      runBiExport({ key, organizationId: a.id, filters: FILTERS });
    const ownRuns = (await exported("payroll_runs")).rows;
    const ownPay = (await exported("payroll_entries")).rows;
    const ownTime = (await exported("workforce_timesheets")).rows;
    assert.equal(ownRuns.length, 1);
    assert.equal(ownRuns[0].legalEntityCode, "BI-A");
    assert.equal(ownPay.length, 1);
    assert.equal(ownPay[0].employeeNo, "BIA-01");
    assert.equal(ownPay[0].grossPay, "6500.00");
    assert.equal(ownTime.length, 1);
    assert.equal(ownTime[0].employeeNo, "BIA-01");
    assert.equal(ownTime[0].currentLegalEntityCode, "BI-A");

    // Foreign legal-entity and unit identifiers can exist as valid single
    // column FKs while still violating the source record's organization.
    await db.update(payrollRuns).set({ legalEntityId: entityB.id })
      .where(eq(payrollRuns.id, runA.id));
    await assert.rejects(() => exported("payroll_runs"), TENANT_SOURCE_MISMATCH);
    await assert.rejects(() => exported("payroll_entries"), TENANT_SOURCE_MISMATCH);
    await db.update(payrollRuns).set({ legalEntityId: entityA.id, scopeOrgUnitId: unitB.id })
      .where(eq(payrollRuns.id, runA.id));
    await assert.rejects(() => exported("payroll_runs"), TENANT_SOURCE_MISMATCH);
    await assert.rejects(() => exported("payroll_entries"), TENANT_SOURCE_MISMATCH);
    await db.update(payrollRuns).set({ scopeOrgUnitId: unitA.id })
      .where(eq(payrollRuns.id, runA.id));

    // The run is A's, but the referenced worker is B's. Before this fix,
    // the employee-level BI export would return B's name and gross pay.
    const [foreignPay] = await db.insert(payrollEntries).values({
      payrollRunId: runA.id, employeeId: workerB.id,
      grossPay: "99000.00", deductions: "1000.00", netPay: "98000.00",
    }).returning({ id: payrollEntries.id });
    await assert.rejects(() => exported("payroll_entries"), TENANT_SOURCE_MISMATCH);
    await db.delete(payrollEntries).where(eq(payrollEntries.id, foreignPay.id));
    assert.deepEqual((await exported("payroll_entries")).rows, ownPay);

    // A timesheet owned by A but linked to B's employee must be rejected,
    // never silently dropped by the join or exported as a foreign identity.
    const [foreignSheet] = await db.insert(workforceTimesheets).values({
      organizationId: a.id, employeeId: workerB.id,
      periodStart: "2026-10-01", periodEnd: "2026-10-15",
      snapshotHash: "b".repeat(64), status: "approved",
    }).returning({ id: workforceTimesheets.id });
    await assert.rejects(() => exported("workforce_timesheets"), TENANT_SOURCE_MISMATCH);
    await db.delete(workforceTimesheets).where(eq(workforceTimesheets.id, foreignSheet.id));
    assert.deepEqual((await exported("workforce_timesheets")).rows, ownTime);

    // Same-org worker, mismatched cross-organization entity/unit FKs:
    // keep foreign entity or unit codes out of current-dimension BI exports.
    await db.update(employees).set({ legalEntityId: entityB.id })
      .where(eq(employees.id, workerA.id));
    await assert.rejects(() => exported("workforce_timesheets"), TENANT_SOURCE_MISMATCH);
    await db.update(employees).set({ legalEntityId: entityA.id, orgUnitId: unitB.id })
      .where(eq(employees.id, workerA.id));
    await assert.rejects(() => exported("workforce_timesheets"), TENANT_SOURCE_MISMATCH);
    await db.update(employees).set({ orgUnitId: unitA.id })
      .where(eq(employees.id, workerA.id));

    // Genuine same-tenant exports remain stable after each negative case.
    assert.deepEqual((await exported("payroll_runs")).rows, ownRuns);
    assert.deepEqual((await exported("payroll_entries")).rows, ownPay);
    assert.deepEqual((await exported("workforce_timesheets")).rows, ownTime);
  } finally {
    for (const organizationId of orgIds) {
      await db.delete(organizations).where(eq(organizations.id, organizationId));
    }
  }
});
