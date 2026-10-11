import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { employeePayProfiles, employees, organizations, payrollEntries, payrollRuns } from "../src/db/schema";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";

test("month-final payroll blocks missing prior cutoff only for existing employees", async () => {
  const [org] = await db.insert(organizations).values({
    name: `Synthetic missing-prior-${randomUUID()}`,
    legalName: "Synthetic cutoff evidence (CI only)",
    plan: "Core",
    statutoryDeductionTiming: "split",
  }).returning();

  try {
    const people = [
      { no: "PRIOR-EXISTING", startDate: "2026-01-01" },
      { no: "FINAL-NEW-HIRE", startDate: "2026-09-20" },
    ];
    const ids: Record<string, number> = {};
    for (const person of people) {
      const [employee] = await db.insert(employees).values({
        organizationId: org.id,
        employeeNo: person.no,
        firstName: "Synthetic",
        lastName: person.no,
        title: "Payroll regression worker",
        avatarInitials: "QA",
        basicRate: "44000.00",
        startDate: person.startDate,
        region: "NCR",
      }).returning();
      ids[person.no] = employee.id;
      await db.insert(employeePayProfiles).values({
        organizationId: org.id,
        employeeId: employee.id,
        payBasis: "monthly",
        rateAmount: "44000.00",
        standardWorkDaysPerMonth: "22.00",
        standardHoursPerDay: "8.00",
      });
    }

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "September final cutoff without first-half ledger (synthetic CI)",
      periodStart: "2026-09-16",
      periodEnd: "2026-09-30",
      scopeLabel: "All locations",
      payDate: "2026-09-30",
      status: "Draft",
    }).returning();
    await enqueuePayrollRun(run.id, 25);
    await drainPayrollQueue(10, run.id);
    const entries = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
    assert.equal(entries.length, 2);

    const flags = (id: number): string[] => {
      const record = entries.find((entry) => entry.employeeId === id);
      assert.ok(record);
      const trace = record.trace as { flags?: unknown };
      return Array.isArray(trace?.flags) ? trace.flags.map(String) : [];
    };
    const existing = entries.find((entry) => entry.employeeId === ids["PRIOR-EXISTING"]);
    assert.equal(existing?.status, "Exception");
    assert.ok(flags(ids["PRIOR-EXISTING"]).some((flag) => flag.startsWith("STATUTORY_TRUE_UP_INPUT_MISSING:")),
      "Missing prior statutory evidence must prevent approval of an existing employee's month-final payroll");
    assert.ok(!flags(ids["FINAL-NEW-HIRE"]).some((flag) => flag.startsWith("STATUTORY_TRUE_UP_INPUT_MISSING:")),
      "A new hire starting in the final cutoff has no earlier statutory ledger requirement");
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});
