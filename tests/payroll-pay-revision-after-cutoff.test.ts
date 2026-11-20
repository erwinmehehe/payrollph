import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { employeePayProfiles, employeePayRevisions, employees, organizations, payrollEntries, payrollRuns } from "../src/db/schema";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";

/**
 * A raise is stored as a pay revision plus the new stored rate the moment it is entered. A cutoff that ended before the raise took
 * effect, but is calculated after the raise was entered (a late draft), must still pay the rate in force then. Golden Phase 37.
 */
async function basicFor(orgId: number, label: string, periodStart: string, periodEnd: string) {
  const [run] = await db.insert(payrollRuns).values({
    organizationId: orgId, periodLabel: label, periodStart, periodEnd, scopeLabel: "All locations", status: "Draft", payDate: periodEnd,
  }).returning();
  await enqueuePayrollRun(run.id, 25);
  await drainPayrollQueue(10, run.id);
  const [entry] = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
  const lines = entry.lineItems as Array<{ code: string; amount: string }>;
  return Number(lines.find((line) => line.code === "BASIC")?.amount);
}

test("a cutoff that ends before a stored raise pays the rate in force then, with one or two later raises", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Pay Revision After Cutoff Test", legalName: "Pay Revision After Cutoff Test Inc.", plan: "Core",
  }).returning();
  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id, employeeNo: "PAY-AFTER-CUTOFF", firstName: "Late", lastName: "Raise", title: "Staff", avatarInitials: "LR",
      basicRate: "26000.00", bankAccount: "1234567890", bankCode: "BDO", startDate: "2025-01-01",
    }).returning();
    // The stored rate is already the newest one (26,000), as the employees API leaves it after the last raise was entered.
    await db.insert(employeePayProfiles).values({
      employeeId: employee.id, organizationId: org.id, payBasis: "monthly", rateAmount: "26000.00",
      standardWorkDaysPerMonth: "22.00", standardHoursPerDay: "8.00",
    });
    const revision = (effectiveDate: string, previous: string, next: string) => ({
      employeeId: employee.id, organizationId: org.id, effectiveDate,
      previousPayBasis: "monthly", previousRateAmount: previous, previousStandardWorkDaysPerMonth: "22.00", previousStandardHoursPerDay: "8.00",
      newPayBasis: "monthly", newRateAmount: next, newStandardWorkDaysPerMonth: "22.00", newStandardHoursPerDay: "8.00",
      reason: "Golden Phase 37", createdBy: "Payroll QA",
    });
    await db.insert(employeePayRevisions).values(revision("2026-09-23", "22000.00", "24000.00"));
    await db.insert(employeePayRevisions).values(revision("2026-11-01", "24000.00", "26000.00"));

    // Before both raises: the original 22,000. Between them: 24,000. After both: 26,000. The raise inside a cutoff still prorates.
    assert.equal(await basicFor(org.id, "Sep 1-15", "2026-09-01", "2026-09-15"), 11000);
    // 11,000 x 7/15 + 12,000 x 8/15 = 5,133.33 + 6,400.00.
    assert.equal(await basicFor(org.id, "Sep 16-30", "2026-09-16", "2026-09-30"), 11533.33);
    assert.equal(await basicFor(org.id, "Oct 1-15", "2026-10-01", "2026-10-15"), 12000);
    assert.equal(await basicFor(org.id, "Nov 1-15", "2026-11-01", "2026-11-15"), 13000);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});
