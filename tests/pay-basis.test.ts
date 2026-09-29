import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  employeePayProfiles,
  employees,
  organizations,
  payrollEntries,
  payrollRuns,
  timePunches,
} from "../src/db/schema";
import {
  attendanceDeductionsForCutoff,
  basicPayForCutoff,
  leaveAdjustmentForCutoff,
  resolvePayProfile,
} from "../src/lib/pay-basis";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";

test("pay basis helper keeps monthly, daily and hourly behavior explicit", () => {
  const monthly = resolvePayProfile({
    payBasis: "monthly",
    rateAmount: 22000,
    standardWorkDaysPerMonth: 22,
    standardHoursPerDay: 8,
  });
  const daily = resolvePayProfile({
    payBasis: "daily",
    rateAmount: 1000,
    standardWorkDaysPerMonth: 22,
    standardHoursPerDay: 8,
  });
  const hourly = resolvePayProfile({
    payBasis: "hourly",
    rateAmount: 125,
    standardWorkDaysPerMonth: 22,
    standardHoursPerDay: 8,
  });

  assert.equal(monthly.monthlyEquivalent, 22000);
  assert.equal(daily.monthlyEquivalent, 22000);
  assert.equal(hourly.monthlyEquivalent, 22000);

  assert.equal(basicPayForCutoff(monthly, 450), 11000, "monthly salary does not switch to attendance-based basic");
  assert.equal(basicPayForCutoff(daily, 450), 937.5, "daily pay follows regular worked-time equivalent");
  assert.equal(basicPayForCutoff(hourly, 450), 937.5, "hourly pay follows regular worked time");

  assert.deepEqual(attendanceDeductionsForCutoff(monthly, 30, 0), {
    tardinessDeduction: 62.5,
    undertimeDeduction: 0,
  });
  assert.deepEqual(attendanceDeductionsForCutoff(daily, 30, 0), {
    tardinessDeduction: 0,
    undertimeDeduction: 0,
  });
  assert.deepEqual(attendanceDeductionsForCutoff(hourly, 30, 0), {
    tardinessDeduction: 0,
    undertimeDeduction: 0,
  });

  assert.equal(leaveAdjustmentForCutoff({ profile: monthly, paidDays: 1, unpaidDays: 0 }), 0);
  assert.equal(leaveAdjustmentForCutoff({ profile: monthly, paidDays: 0, unpaidDays: 1 }), -1000);
  assert.equal(leaveAdjustmentForCutoff({ profile: daily, paidDays: 1, unpaidDays: 0 }), 1000);
  assert.equal(leaveAdjustmentForCutoff({ profile: hourly, paidDays: 1, unpaidDays: 0 }), 1000);
});

test("payroll engine uses explicit pay basis and avoids double tardiness deduction", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Explicit Pay Basis Test",
    legalName: "Explicit Pay Basis Test Inc.",
    plan: "Core",
  }).returning();

  try {
    const staff = await db.insert(employees).values([
      {
        organizationId: org.id,
        employeeNo: "PB-MONTHLY",
        firstName: "Monthly",
        lastName: "Employee",
        title: "Staff",
        avatarInitials: "ME",
        basicRate: "22000.00",
        startDate: "2025-01-01",
      },
      {
        organizationId: org.id,
        employeeNo: "PB-DAILY",
        firstName: "Daily",
        lastName: "Employee",
        title: "Staff",
        avatarInitials: "DE",
        basicRate: "22000.00",
        startDate: "2025-01-01",
      },
      {
        organizationId: org.id,
        employeeNo: "PB-HOURLY",
        firstName: "Hourly",
        lastName: "Employee",
        title: "Staff",
        avatarInitials: "HE",
        basicRate: "22000.00",
        startDate: "2025-01-01",
      },
    ]).returning();

    await db.insert(employeePayProfiles).values([
      {
        employeeId: staff[0].id,
        organizationId: org.id,
        payBasis: "monthly",
        rateAmount: "22000.00",
        standardWorkDaysPerMonth: "22.00",
        standardHoursPerDay: "8.00",
      },
      {
        employeeId: staff[1].id,
        organizationId: org.id,
        payBasis: "daily",
        rateAmount: "1000.00",
        standardWorkDaysPerMonth: "22.00",
        standardHoursPerDay: "8.00",
      },
      {
        employeeId: staff[2].id,
        organizationId: org.id,
        payBasis: "hourly",
        rateAmount: "125.00",
        standardWorkDaysPerMonth: "22.00",
        standardHoursPerDay: "8.00",
      },
    ]);

    await db.insert(timePunches).values([
      {
        organizationId: org.id,
        employeeId: staff[0].id,
        workDate: "2026-09-21",
        timeIn: new Date("2026-09-21T09:30:00+08:00"),
        timeOut: new Date("2026-09-21T18:00:00+08:00"),
        shiftStart: "09:00",
        shiftEnd: "18:00",
        status: "Complete",
      },
      {
        organizationId: org.id,
        employeeId: staff[1].id,
        workDate: "2026-09-21",
        timeIn: new Date("2026-09-21T09:30:00+08:00"),
        timeOut: new Date("2026-09-21T18:00:00+08:00"),
        shiftStart: "09:00",
        shiftEnd: "18:00",
        status: "Complete",
      },
      {
        organizationId: org.id,
        employeeId: staff[2].id,
        workDate: "2026-09-21",
        timeIn: new Date("2026-09-21T09:00:00+08:00"),
        timeOut: new Date("2026-09-21T18:00:00+08:00"),
        shiftStart: "09:00",
        shiftEnd: "18:00",
        status: "Complete",
      },
    ]);

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Sep 16–30, 2026 pay basis",
      periodStart: "2026-09-16",
      periodEnd: "2026-09-30",
      scopeLabel: "All locations",
      status: "Draft",
      payDate: "2026-09-30",
    }).returning();

    await enqueuePayrollRun(run.id, 25);
    await drainPayrollQueue(10, run.id);

    const entries = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
    const byEmployee = new Map(entries.map((entry) => [entry.employeeId, entry]));

    const monthlyEntry = byEmployee.get(staff[0].id)!;
    const dailyEntry = byEmployee.get(staff[1].id)!;
    const hourlyEntry = byEmployee.get(staff[2].id)!;

    const lines = (entry: typeof monthlyEntry) => entry.lineItems as Array<{ code: string; amount: string }>;
    assert.equal(Number(lines(monthlyEntry).find((line) => line.code === "BASIC")?.amount), 11000);
    assert.equal(Number(lines(monthlyEntry).find((line) => line.code === "LATE")?.amount), -52.08, "5-minute grace makes 09:30 equal 25 deductible late minutes");

    assert.equal(Number(lines(dailyEntry).find((line) => line.code === "BASIC")?.amount), 937.5);
    assert.equal(lines(dailyEntry).some((line) => line.code === "LATE"), false, "daily basic already reflects late worked time");

    assert.equal(Number(lines(hourlyEntry).find((line) => line.code === "BASIC")?.amount), 1000);

    const monthlyTrace = monthlyEntry.trace as { inputs?: string[] };
    const dailyTrace = dailyEntry.trace as { inputs?: string[] };
    const hourlyTrace = hourlyEntry.trace as { inputs?: string[] };
    assert.ok(monthlyTrace.inputs?.includes("payBasis=monthly"));
    assert.ok(dailyTrace.inputs?.includes("payBasis=daily"));
    assert.ok(hourlyTrace.inputs?.includes("payBasis=hourly"));
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});
