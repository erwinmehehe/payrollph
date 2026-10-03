import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  employeePayProfiles,
  employeePayRevisions,
  employeePayRetroAdjustments,
  employees,
  organizations,
  payrollEntries,
  payrollRuns,
  timePunches,
} from "../src/db/schema";
import {
  attendanceDeductionsForCutoff,
  basicPayForCutoff,
  fixedMonthlyBasicForTimeline,
  leaveAdjustmentForCutoff,
  monthlyRetroForReleasedCutoff,
  resolvePayProfile,
  resolvePayTimeline,
} from "../src/lib/pay-basis";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";
import { settlePayrollRun } from "../src/lib/payroll-settlement";

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


test("release refuses a pay profile changed after payroll calculation", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Pay Basis Freshness Test",
    legalName: "Pay Basis Freshness Test Inc.",
    plan: "Core",
  }).returning();

  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "PB-STALE",
      firstName: "Stale",
      lastName: "Profile",
      title: "Staff",
      avatarInitials: "SP",
      basicRate: "22000.00",
      bankAccount: "1234567890",
      bankCode: "BDO",
      startDate: "2025-01-01",
    }).returning();

    await db.insert(employeePayProfiles).values({
      employeeId: employee.id,
      organizationId: org.id,
      payBasis: "monthly",
      rateAmount: "22000.00",
      standardWorkDaysPerMonth: "22.00",
      standardHoursPerDay: "8.00",
    });

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Sep 16–30, 2026 stale pay profile",
      periodStart: "2026-09-16",
      periodEnd: "2026-09-30",
      scopeLabel: "All locations",
      status: "Draft",
      payDate: "2026-09-30",
    }).returning();

    await enqueuePayrollRun(run.id, 25);
    await drainPayrollQueue(10, run.id);

    await db.update(employeePayProfiles)
      .set({ payBasis: "daily", rateAmount: "1000.00", updatedAt: new Date() })
      .where(eq(employeePayProfiles.employeeId, employee.id));
    await db.update(payrollRuns).set({ status: "Releasing" }).where(eq(payrollRuns.id, run.id));

    await assert.rejects(
      () => settlePayrollRun(run.id),
      /Pay profile for Stale Profile changed after calculation/,
    );

    const [freshRun] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, run.id));
    assert.equal(freshRun.status, "Releasing", "failed settlement must not silently release stale payroll");
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});


test("effective-dated monthly pay prorates the cutoff without rewriting earlier days", () => {
  const timeline = resolvePayTimeline({
    currentProfile: {
      payBasis: "monthly",
      rateAmount: 26000,
      standardWorkDaysPerMonth: 22,
      standardHoursPerDay: 8,
    },
    revisions: [{
      effectiveDate: "2026-09-23",
      previousPayBasis: "monthly",
      previousRateAmount: 22000,
      previousStandardWorkDaysPerMonth: 22,
      previousStandardHoursPerDay: 8,
      newPayBasis: "monthly",
      newRateAmount: 26000,
      newStandardWorkDaysPerMonth: 22,
      newStandardHoursPerDay: 8,
      reason: "Promotion",
    }],
    periodStart: "2026-09-16",
    periodEnd: "2026-09-30",
  });

  assert.deepEqual(
    timeline.map((segment) => [segment.startDate, segment.endDate, segment.profile.rateAmount]),
    [
      ["2026-09-16", "2026-09-22", 22000],
      ["2026-09-23", "2026-09-30", 26000],
    ],
  );
  assert.equal(
    Number(fixedMonthlyBasicForTimeline(timeline, "2026-09-16", "2026-09-30").toFixed(2)),
    12066.67,
  );
  assert.equal(monthlyRetroForReleasedCutoff({
    previousMonthlyRate: 22000,
    newMonthlyRate: 26000,
    effectiveDate: "2026-09-23",
    periodStart: "2026-09-16",
    periodEnd: "2026-09-30",
  }), 1066.67);
});

test("monthly salary is prorated when employment starts partway through a cutoff", () => {
  const timeline = resolvePayTimeline({
    currentProfile: {
      payBasis: "monthly",
      rateAmount: 30_000,
      standardWorkDaysPerMonth: 22,
      standardHoursPerDay: 8,
    },
    revisions: [],
    periodStart: "2026-10-01",
    periodEnd: "2026-10-15",
  });

  assert.equal(
    fixedMonthlyBasicForTimeline(timeline, "2026-10-01", "2026-10-15", "2026-10-10"),
    6_000,
  );
  assert.equal(
    fixedMonthlyBasicForTimeline(timeline, "2026-10-01", "2026-10-15", "2026-10-16"),
    0,
  );
});

test("payroll engine applies a monthly raise from its exact effective date", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Effective Pay Timeline Test",
    legalName: "Effective Pay Timeline Test Inc.",
    plan: "Core",
  }).returning();

  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "PAY-TIMELINE",
      firstName: "Effective",
      lastName: "Rate",
      title: "Staff",
      avatarInitials: "ER",
      basicRate: "26000.00",
      bankAccount: "1234567890",
      bankCode: "BDO",
      startDate: "2025-01-01",
    }).returning();

    await db.insert(employeePayProfiles).values({
      employeeId: employee.id,
      organizationId: org.id,
      payBasis: "monthly",
      rateAmount: "26000.00",
      standardWorkDaysPerMonth: "22.00",
      standardHoursPerDay: "8.00",
    });
    await db.insert(employeePayRevisions).values({
      employeeId: employee.id,
      organizationId: org.id,
      effectiveDate: "2026-09-23",
      previousPayBasis: "monthly",
      previousRateAmount: "22000.00",
      previousStandardWorkDaysPerMonth: "22.00",
      previousStandardHoursPerDay: "8.00",
      newPayBasis: "monthly",
      newRateAmount: "26000.00",
      newStandardWorkDaysPerMonth: "22.00",
      newStandardHoursPerDay: "8.00",
      reason: "Promotion",
      createdBy: "Payroll QA",
    });

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Sep 16–30, 2026 effective pay",
      periodStart: "2026-09-16",
      periodEnd: "2026-09-30",
      scopeLabel: "All locations",
      status: "Draft",
      payDate: "2026-09-30",
    }).returning();

    await enqueuePayrollRun(run.id, 25);
    await drainPayrollQueue(10, run.id);

    const [entry] = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
    const lines = entry.lineItems as Array<{ code: string; amount: string }>;
    assert.equal(Number(lines.find((line) => line.code === "BASIC")?.amount), 12066.67);

    const trace = entry.trace as { inputs?: string[] };
    assert.ok(trace.inputs?.some((line) =>
      line === "payTimeline=2026-09-16..2026-09-22:monthly@22000.00|2026-09-23..2026-09-30:monthly@26000.00"
    ));
    assert.ok(trace.inputs?.includes("effectivePayChanges=1"));
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("pending retro pay is included once and settled only on payroll release", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Retro Pay Settlement Test",
    legalName: "Retro Pay Settlement Test Inc.",
    plan: "Core",
  }).returning();

  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "RETRO-EMP",
      firstName: "Retro",
      lastName: "Employee",
      title: "Staff",
      avatarInitials: "RE",
      basicRate: "26000.00",
      bankAccount: "1234567890",
      bankCode: "BDO",
      startDate: "2025-01-01",
    }).returning();

    await db.insert(employeePayProfiles).values({
      employeeId: employee.id,
      organizationId: org.id,
      payBasis: "monthly",
      rateAmount: "26000.00",
      standardWorkDaysPerMonth: "22.00",
      standardHoursPerDay: "8.00",
    });
    const [revision] = await db.insert(employeePayRevisions).values({
      employeeId: employee.id,
      organizationId: org.id,
      effectiveDate: "2026-09-23",
      previousPayBasis: "monthly",
      previousRateAmount: "22000.00",
      previousStandardWorkDaysPerMonth: "22.00",
      previousStandardHoursPerDay: "8.00",
      newPayBasis: "monthly",
      newRateAmount: "26000.00",
      newStandardWorkDaysPerMonth: "22.00",
      newStandardHoursPerDay: "8.00",
      reason: "Late promotion entry",
      createdBy: "Payroll QA",
    }).returning();

    const [sourceRun] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Sep 16–30, 2026 released",
      periodStart: "2026-09-16",
      periodEnd: "2026-09-30",
      scopeLabel: "All locations",
      status: "Released",
      payDate: "2026-09-30",
      employeeCount: 1,
    }).returning();

    const [retro] = await db.insert(employeePayRetroAdjustments).values({
      organizationId: org.id,
      employeeId: employee.id,
      revisionId: revision.id,
      sourcePayrollRunId: sourceRun.id,
      sourcePeriodLabel: sourceRun.periodLabel,
      amount: "1066.67",
      status: "pending",
    }).returning();

    const [nextRun] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Oct 1–15, 2026",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-15",
      scopeLabel: "All locations",
      status: "Draft",
      payDate: "2026-10-15",
    }).returning();

    await enqueuePayrollRun(nextRun.id, 25);
    await drainPayrollQueue(10, nextRun.id);

    const [entry] = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, nextRun.id));
    const lines = entry.lineItems as Array<{ code: string; amount: string }>;
    assert.equal(Number(lines.find((line) => line.code === `RETRO-${retro.id}`)?.amount), 1066.67);

    await db.update(employeePayRetroAdjustments)
      .set({ amount: "1200.00" })
      .where(eq(employeePayRetroAdjustments.id, retro.id));
    await db.update(payrollRuns).set({ status: "Releasing" }).where(eq(payrollRuns.id, nextRun.id));
    await assert.rejects(
      () => settlePayrollRun(nextRun.id),
      /Retro pay adjustment .* changed after calculation/,
    );

    await db.update(employeePayRetroAdjustments)
      .set({ amount: "1066.67" })
      .where(eq(employeePayRetroAdjustments.id, retro.id));
    const released = await settlePayrollRun(nextRun.id);
    assert.equal(released.settlement.retroAdjustmentsSettled, 1);

    const [settledRetro] = await db.select().from(employeePayRetroAdjustments)
      .where(eq(employeePayRetroAdjustments.id, retro.id));
    assert.equal(settledRetro.status, "settled");
    assert.equal(settledRetro.settledPayrollRunId, nextRun.id);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});
