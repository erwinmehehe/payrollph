import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  employeeLoans,
  employeePayProfiles,
  employeePayRevisions,
  employeePayRetroAdjustments,
  employees,
  leaveConversions,
  organizations,
  payrollEntries,
  payrollRuns,
  timePunches,
} from "../src/db/schema";
import {
  attendanceDeductionsForCutoff,
  basicPayForCutoff,
  effectivePayProfileForDate,
  fixedMonthlyBasicForTimeline,
  leaveAdjustmentForCutoff,
  monthlyRetroForReleasedCutoff,
  resolvePayProfile,
  resolvePayTimeline,
} from "../src/lib/pay-basis";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";
import { computePagIbig, computePhilHealth, computeSss } from "../src/lib/payroll-rules";
import { settlePayrollRun } from "../src/lib/payroll-settlement";

// Isolated synthetic keys; never expose or reuse a key in production.
const priorTestBankKey = process.env.BANK_DATA_ENCRYPTION_KEY;
test.before(() => { process.env.BANK_DATA_ENCRYPTION_KEY = "a".repeat(64); });
test.after(() => {
  if (priorTestBankKey === undefined) delete process.env.BANK_DATA_ENCRYPTION_KEY;
  else process.env.BANK_DATA_ENCRYPTION_KEY = priorTestBankKey;
});

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


test("historical WFM labor rates resolve from pay revision history, not the current profile", () => {
  const currentProfile = {
    payBasis: "monthly",
    rateAmount: 26000,
    standardWorkDaysPerMonth: 22,
    standardHoursPerDay: 8,
  };
  const revisions = [{
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
  }];

  assert.equal(
    Number(effectivePayProfileForDate({
      currentProfile,
      revisions,
      workDate: "2026-09-20",
    }).hourlyRate.toFixed(4)),
    125,
  );
  assert.equal(
    Number(effectivePayProfileForDate({
      currentProfile,
      revisions,
      workDate: "2026-09-24",
    }).hourlyRate.toFixed(4)),
    147.7273,
  );
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


test("mid-cutoff monthly hire is prorated from employment start and future hires are excluded", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Mid Cutoff Hire Test",
    legalName: "Mid Cutoff Hire Test Inc.",
    plan: "Core",
  }).returning();

  try {
    const [midHire, futureHire] = await db.insert(employees).values([
      {
        organizationId: org.id,
        employeeNo: "MID-HIRE",
        firstName: "Mid",
        lastName: "Hire",
        title: "Staff",
        avatarInitials: "MH",
        basicRate: "30000.00",
        startDate: "2026-09-24",
      },
      {
        organizationId: org.id,
        employeeNo: "FUTURE-HIRE",
        firstName: "Future",
        lastName: "Hire",
        title: "Staff",
        avatarInitials: "FH",
        basicRate: "30000.00",
        startDate: "2026-10-01",
      },
    ]).returning();

    await db.insert(employeePayProfiles).values([
      {
        employeeId: midHire.id,
        organizationId: org.id,
        payBasis: "monthly",
        rateAmount: "30000.00",
        standardWorkDaysPerMonth: "22.00",
        standardHoursPerDay: "8.00",
      },
      {
        employeeId: futureHire.id,
        organizationId: org.id,
        payBasis: "monthly",
        rateAmount: "30000.00",
        standardWorkDaysPerMonth: "22.00",
        standardHoursPerDay: "8.00",
      },
    ]);

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Sep 16–30, 2026 mid-hire",
      periodStart: "2026-09-16",
      periodEnd: "2026-09-30",
      scopeLabel: "All locations",
      status: "Draft",
      payDate: "2026-09-30",
    }).returning();

    const queued = await enqueuePayrollRun(run.id, 25);
    assert.equal(queued.employeeCount, 1, "future hires must not enter the payroll cohort");

    await drainPayrollQueue(10, run.id);

    const entries = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].employeeId, midHire.id);

    const lines = entries[0].lineItems as Array<{ code: string; amount: string }>;
    assert.equal(
      Number(lines.find((line) => line.code === "BASIC")?.amount),
      7000,
      "Sep 24–30 is 7 of 15 cutoff calendar days, so 15,000 semi-monthly basic prorates to 7,000",
    );

    const trace = entries[0].trace as { inputs?: string[] };
    assert.ok(trace.inputs?.includes("employmentStart=2026-09-24"));
    assert.ok(trace.inputs?.includes("statutoryMonthlyCompensation=7000.00"));
    assert.ok(trace.inputs?.includes("statutoryReconciliation=new-hire-final-cutoff-actual"));
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("insufficient net pay prioritizes government loans and carries the remainder forward", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Loan Priority Test",
    legalName: "Loan Priority Test Inc.",
    plan: "Core",
  }).returning();

  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "LOAN-PRIORITY",
      firstName: "Loan",
      lastName: "Priority",
      title: "Staff",
      avatarInitials: "LP",
      basicRate: "20000.00",
      startDate: "2025-01-01",
    }).returning();

    await db.insert(employeePayProfiles).values({
      employeeId: employee.id,
      organizationId: org.id,
      payBasis: "monthly",
      rateAmount: "20000.00",
      standardWorkDaysPerMonth: "22.00",
      standardHoursPerDay: "8.00",
    });

    const [sssLoan, companyLoan] = await db.insert(employeeLoans).values([
      {
        organizationId: org.id,
        employeeId: employee.id,
        loanType: "SSS Salary Loan",
        referenceNo: "SSS-PRIORITY",
        principal: "12000.00",
        monthlyAmortization: "12000.00",
        cutoffDeduction: "6000.00",
        remainingBalance: "12000.00",
        totalPaid: "0.00",
        status: "active",
        startDate: "2026-01-01",
      },
      {
        organizationId: org.id,
        employeeId: employee.id,
        loanType: "Company Loan",
        referenceNo: "COMPANY-PRIORITY",
        principal: "12000.00",
        monthlyAmortization: "12000.00",
        cutoffDeduction: "6000.00",
        remainingBalance: "12000.00",
        totalPaid: "0.00",
        status: "active",
        startDate: "2026-01-01",
      },
    ]).returning();

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Sep 16–30, 2026 loan priority",
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
    const sssLine = lines.find((line) => line.code === `LOAN-${sssLoan.id}`);
    const companyLine = lines.find((line) => line.code === `LOAN-${companyLoan.id}`);

    assert.equal(Number(sssLine?.amount), -6000, "government loan gets first claim on available net pay");
    assert.ok(Number(companyLine?.amount) > -6000 && Number(companyLine?.amount) <= 0, "company loan is capped to remaining net pay");
    assert.equal(Number(entry.netPay), 0, "loan deductions may consume available net but must never make net negative");

    const trace = entry.trace as { inputs?: string[]; flags?: string[] };
    assert.ok(trace.inputs?.includes("loanRequested=12000.00"));
    assert.ok(trace.inputs?.some((line) => line.startsWith("loanDeducted=")));
    assert.ok(trace.flags?.some((flag) => flag.includes("Company Loan deduction was limited")));
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});


test("below-reference wage does not automatically grant MWE tax exemption", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Explicit MWE Classification Test",
    legalName: "Explicit MWE Classification Test Inc.",
    plan: "Core",
  }).returning();

  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "MWE-EXPLICIT",
      firstName: "Explicit",
      lastName: "Classification",
      title: "Staff",
      avatarInitials: "EC",
      basicRate: "10000.00",
      mwe: false,
      region: "NCR",
      startDate: "2025-01-01",
    }).returning();

    await db.insert(employeePayProfiles).values({
      employeeId: employee.id,
      organizationId: org.id,
      payBasis: "monthly",
      rateAmount: "10000.00",
      standardWorkDaysPerMonth: "22.00",
      standardHoursPerDay: "8.00",
    });

    await db.insert(leaveConversions).values({
      organizationId: org.id,
      employeeId: employee.id,
      leaveType: "Vacation leave",
      daysConverted: "20.0",
      dailyRate: "1500.00",
      cashAmount: "30000.00",
      taxExempt: false,
      status: "approved",
    });

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Sep 16–30, 2026 explicit MWE",
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
    const withholding = Math.abs(Number(lines.find((line) => line.code === "WHT")?.amount ?? 0));

    assert.ok(withholding > 0, "taxable supplementary compensation must remain taxable when employee.mwe is false");
    const trace = entry.trace as { inputs?: string[]; flags?: string[] };
    assert.ok(trace.inputs?.includes("mwe=false"));
    assert.ok(
      trace.inputs?.includes("mweClassificationSource=default_non_mwe"),
      "non-MWE treatment should carry explicit classification provenance",
    );
    assert.ok(
      trace.flags?.some((flag) => flag.includes("payroll did not infer MWE tax status automatically")),
      "wage-reference mismatch should be a review flag, not a tax-status override",
    );
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("SSS and Pag-IBIG use remunerative earnings while PhilHealth remains basic-only", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Statutory Compensation Base Test",
    legalName: "Statutory Compensation Base Test Inc.",
    plan: "Core",
  }).returning();

  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "STAT-BASE",
      firstName: "Statutory",
      lastName: "Base",
      title: "Staff",
      avatarInitials: "SB",
      basicRate: "20000.00",
      startDate: "2025-01-01",
    }).returning();

    await db.insert(employeePayProfiles).values({
      employeeId: employee.id,
      organizationId: org.id,
      payBasis: "monthly",
      rateAmount: "20000.00",
      standardWorkDaysPerMonth: "22.00",
      standardHoursPerDay: "8.00",
    });

    await db.insert(timePunches).values({
      organizationId: org.id,
      employeeId: employee.id,
      workDate: "2026-09-21",
      timeIn: new Date("2026-09-21T09:00:00+08:00"),
      timeOut: new Date("2026-09-21T20:00:00+08:00"),
      shiftStart: "09:00",
      shiftEnd: "18:00",
      status: "Complete",
    });

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Sep 16–30, 2026 statutory base",
      periodStart: "2026-09-16",
      periodEnd: "2026-09-30",
      scopeLabel: "All locations",
      status: "Draft",
      payDate: "2026-09-30",
    }).returning();

    await enqueuePayrollRun(run.id, 25);
    await drainPayrollQueue(10, run.id);

    const [entry] = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
    const trace = entry.trace as { inputs?: string[] };
    const inputs = trace.inputs ?? [];
    const readNumber = (prefix: string) => Number(inputs.find((line) => line.startsWith(prefix))?.slice(prefix.length) ?? NaN);

    const statutoryMonthly = readNumber("statutoryMonthlyCompensation=");
    const sssMsc = readNumber("sssMonthlySalaryCredit=");
    const philHealthBase = readNumber("philHealthContributionBase=");
    const pagIbigBase = readNumber("pagIbigFundSalary=");

    assert.ok(statutoryMonthly > 20000, "overtime/remunerative earnings must raise the SSS/Pag-IBIG compensation basis above basic");
    assert.ok(sssMsc > 20000, "SSS MSC must reflect actual remuneration rather than basic salary alone");
    assert.equal(philHealthBase, 20000, "PhilHealth must stay on monthly basic salary");
    assert.equal(pagIbigBase, 10000, "Pag-IBIG fund salary remains capped at 10,000");
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});


test("month-final cutoff true-ups statutory employee shares against the released first cutoff", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Statutory Monthly True Up Test",
    legalName: "Statutory Monthly True Up Test Inc.",
    plan: "Core",
  }).returning();

  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "STAT-TRUEUP",
      firstName: "Statutory",
      lastName: "Trueup",
      title: "Staff",
      avatarInitials: "ST",
      basicRate: "20000.00",
      startDate: "2025-01-01",
    }).returning();

    await db.insert(employeePayProfiles).values({
      employeeId: employee.id,
      organizationId: org.id,
      payBasis: "monthly",
      rateAmount: "20000.00",
      standardWorkDaysPerMonth: "22.00",
      standardHoursPerDay: "8.00",
    });

    // First cutoff includes overtime, so the final monthly remuneration is not
    // simply basic salary and the second cutoff must reconcile from the ledger.
    await db.insert(timePunches).values({
      organizationId: org.id,
      employeeId: employee.id,
      workDate: "2026-09-10",
      timeIn: new Date("2026-09-10T09:00:00+08:00"),
      timeOut: new Date("2026-09-10T20:00:00+08:00"),
      shiftStart: "09:00",
      shiftEnd: "18:00",
      status: "Complete",
    });

    const [firstRun] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Sep 1–15, 2026 true-up",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-15",
      scopeLabel: "All locations",
      status: "Draft",
      payDate: "2026-09-15",
    }).returning();

    await enqueuePayrollRun(firstRun.id, 25);
    await drainPayrollQueue(10, firstRun.id);
    await db.update(payrollRuns).set({ status: "Released" }).where(eq(payrollRuns.id, firstRun.id));

    const [firstEntry] = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, firstRun.id));

    const [secondRun] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Sep 16–30, 2026 true-up",
      periodStart: "2026-09-16",
      periodEnd: "2026-09-30",
      scopeLabel: "All locations",
      status: "Draft",
      payDate: "2026-09-30",
    }).returning();

    await enqueuePayrollRun(secondRun.id, 25);
    await drainPayrollQueue(10, secondRun.id);

    const [secondEntry] = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, secondRun.id));
    const firstLines = firstEntry.lineItems as Array<{ code: string; amount: string }>;
    const secondLines = secondEntry.lineItems as Array<{ code: string; amount: string }>;
    const contribution = (lines: Array<{ code: string; amount: string }>, code: string) =>
      -(Number(lines.find((line) => line.code === code)?.amount ?? 0));

    const secondTrace = secondEntry.trace as { inputs?: string[] };
    const inputs = secondTrace.inputs ?? [];
    const readNumber = (prefix: string) => Number(inputs.find((line) => line.startsWith(prefix))?.slice(prefix.length) ?? NaN);
    const monthlyRemuneration = readNumber("statutoryMonthlyCompensation=");

    assert.ok(inputs.includes("statutoryReconciliation=month-final-ledger-true-up"));
    assert.ok(monthlyRemuneration > 20000, "first-cutoff OT must remain in the final actual monthly remuneration");

    const sss = computeSss(monthlyRemuneration);
    const ph = computePhilHealth(20000);
    const hdmf = computePagIbig(monthlyRemuneration);

    assert.equal(
      Math.round((contribution(firstLines, "SSS") + contribution(secondLines, "SSS")) * 100) / 100,
      sss.employee,
    );
    assert.equal(
      Math.round((contribution(firstLines, "PHIC") + contribution(secondLines, "PHIC")) * 100) / 100,
      ph.employee,
    );
    assert.equal(
      Math.round((contribution(firstLines, "HDMF") + contribution(secondLines, "HDMF")) * 100) / 100,
      hdmf.employee,
    );
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});
