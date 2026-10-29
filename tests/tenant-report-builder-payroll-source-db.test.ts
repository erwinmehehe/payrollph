import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  employees, legalEntities, organizations, orgUnits, payrollEntries, payrollRuns,
} from "../src/db/schema";
import { getBuilderFacts } from "../src/lib/tenant-report-builder-server";

// Disposable PG only, using fictional employers and workers. No payout or real data.
test("tenant report builder refuses foreign payroll worker rows rather than disclosing salary", async () => {
  const orgIds: number[] = [];
  try {
    const [orgA, orgB] = await db.insert(organizations).values([
      { name: "Fictional builder isolation employer A", legalName: "Fictional builder A" },
      { name: "Fictional builder isolation employer B", legalName: "Fictional builder B" },
    ]).returning({ id: organizations.id });
    orgIds.push(orgA.id, orgB.id);

    const [entityA, entityB] = await db.insert(legalEntities).values([
      { organizationId: orgA.id, code: "BLD-RPT-A", legalName: "Fictional builder entity A",
        displayName: "Fictional builder A", primaryEntity: true },
      { organizationId: orgB.id, code: "BLD-RPT-B", legalName: "Fictional builder entity B",
        displayName: "Fictional builder B", primaryEntity: true },
    ]).returning({ id: legalEntities.id });
    const [unitA, unitB] = await db.insert(orgUnits).values([
      { organizationId: orgA.id, legalEntityId: entityA.id,
        type: "department", name: "Operations", code: "BRPTA" },
      { organizationId: orgB.id, legalEntityId: entityB.id,
        type: "department", name: "Finance", code: "BRPTB" },
    ]).returning({ id: orgUnits.id });
    const [workerA, workerB] = await db.insert(employees).values([
      { organizationId: orgA.id, legalEntityId: entityA.id, orgUnitId: unitA.id,
        employeeNo: "BUILDER-A", firstName: "Fictional", lastName: "WorkerA",
        title: "Operator", avatarInitials: "FA", basicRate: "22000.00",
        startDate: "2026-01-01" },
      { organizationId: orgB.id, legalEntityId: entityB.id, orgUnitId: unitB.id,
        employeeNo: "BUILDER-B", firstName: "Fictional", lastName: "WorkerB",
        title: "Operator", avatarInitials: "FB", basicRate: "33000.00",
        startDate: "2026-01-01" },
    ]).returning({ id: employees.id });
    const [runA, runB] = await db.insert(payrollRuns).values([
      { organizationId: orgA.id, legalEntityId: entityA.id, scopeOrgUnitId: unitA.id,
        periodLabel: "October 2026 first cutoff", periodStart: "2026-10-01",
        periodEnd: "2026-10-15", payDate: "2026-10-15", status: "Released" },
      { organizationId: orgB.id, legalEntityId: entityB.id, scopeOrgUnitId: unitB.id,
        periodLabel: "October 2026 first cutoff", periodStart: "2026-10-01",
        periodEnd: "2026-10-15", payDate: "2026-10-15", status: "Released" },
    ]).returning({ id: payrollRuns.id });
    await db.insert(payrollEntries).values([
      { payrollRunId: runA.id, employeeId: workerA.id, grossPay: "6000.00",
        deductions: "1000.00", netPay: "5000.00", lineItems: [{ code: "OT", amount: "125.50" }] },
      { payrollRunId: runB.id, employeeId: workerB.id, grossPay: "8000.00",
        deductions: "1000.00", netPay: "7000.00", lineItems: [{ code: "OT", amount: "800.00" }] },
    ]);
    const request = {
      organizationId: orgA.id, dataset: "payroll" as const,
      startDate: "2026-10-01", endDate: "2026-10-31",
    };
    const own = await getBuilderFacts(request);
    assert.deepEqual(own, [{
      department: "BRPTA", status: "Released", payrollCost: "6000.00", otLineCost: "125.50",
    }], "valid own-employer payroll must remain visible");

    // This inconsistent run/employee link must not leak the other tenant's
    // wages into employer A's aggregate, even though the run itself is A's.
    const [foreignEntry] = await db.insert(payrollEntries).values({
      payrollRunId: runA.id, employeeId: workerB.id,
      grossPay: "90000.00", deductions: "1000.00", netPay: "89000.00",
      lineItems: [{ code: "OT", amount: "2000.00" }],
    }).returning({ id: payrollEntries.id });
    await assert.rejects(() => getBuilderFacts(request), /source attribution/);
    await db.delete(payrollEntries).where(eq(payrollEntries.id, foreignEntry.id));
    assert.deepEqual(await getBuilderFacts(request), own);

    // Even inside one organization, a payroll run cannot claim an employee
    // currently attributed to a different legal employer.
    await db.update(employees).set({ legalEntityId: entityB.id })
      .where(eq(employees.id, workerA.id));
    await assert.rejects(() => getBuilderFacts(request), /source attribution/);
    await db.update(employees).set({ legalEntityId: entityA.id })
      .where(eq(employees.id, workerA.id));
    assert.deepEqual(await getBuilderFacts(request), own);
  } finally {
    for (const orgId of orgIds) {
      await db.delete(organizations).where(eq(organizations.id, orgId));
    }
  }
});
