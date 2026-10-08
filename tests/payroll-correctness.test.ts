import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  approvalTasks,
  bankTemplates,
  employeeLoans,
  employees,
  expenseClaims,
  leaveConversions,
  leavePolicies,
  leaveRequests,
  loanPayments,
  organizations,
  orgUnits,
  payrollEntries,
  payrollRuns,
  payslips,
  timePunches,
} from "../src/db/schema";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";
import { settlePayrollRun } from "../src/lib/payroll-settlement";
import { buildPayrollAssurance } from "../src/lib/payroll-assurance-server";
import { generateBankFile } from "../src/lib/exporters";
import { allocateLeaveDaysToPeriod } from "../src/lib/leave-payroll";
import { holidayCalendarFingerprint } from "../src/lib/payroll-calendar";
import { NATIONAL_HOLIDAYS_2026 } from "../src/lib/wage-orders";

test("payroll calculation uses only employees in scope and punches inside the cutoff", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Payroll Scope Test",
    legalName: "Payroll Scope Test Inc.",
    plan: "Core",
  }).returning();

  try {
    const [unitA, unitB] = await db.insert(orgUnits).values([
      { organizationId: org.id, type: "Branch", name: "Unit A", code: "UA" },
      { organizationId: org.id, type: "Branch", name: "Unit B", code: "UB" },
    ]).returning();

    const [inScope, outOfScope] = await db.insert(employees).values([
      {
        organizationId: org.id,
        orgUnitId: unitA.id,
        employeeNo: "SCOPE-001",
        firstName: "In",
        lastName: "Scope",
        title: "Associate",
        avatarInitials: "IS",
        basicRate: "30000.00",
        startDate: "2025-01-01",
      },
      {
        organizationId: org.id,
        orgUnitId: unitB.id,
        employeeNo: "SCOPE-002",
        firstName: "Out",
        lastName: "Scope",
        title: "Associate",
        avatarInitials: "OS",
        basicRate: "30000.00",
        startDate: "2025-01-01",
      },
    ]).returning();

    await db.insert(timePunches).values([
      {
        organizationId: org.id,
        employeeId: inScope.id,
        workDate: "2026-09-20",
        timeIn: new Date("2026-09-20T09:00:00+08:00"),
        timeOut: new Date("2026-09-20T18:00:00+08:00"),
        shiftStart: "09:00",
        shiftEnd: "18:00",
        status: "Complete",
      },
      {
        organizationId: org.id,
        employeeId: inScope.id,
        workDate: "2026-09-10",
        timeIn: new Date("2026-09-10T09:00:00+08:00"),
        timeOut: new Date("2026-09-10T23:00:00+08:00"),
        shiftStart: "09:00",
        shiftEnd: "18:00",
        status: "Complete",
      },
      {
        organizationId: org.id,
        employeeId: outOfScope.id,
        workDate: "2026-09-20",
        timeIn: new Date("2026-09-20T09:00:00+08:00"),
        timeOut: new Date("2026-09-20T18:00:00+08:00"),
        shiftStart: "09:00",
        shiftEnd: "18:00",
        status: "Complete",
      },
    ]);

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Sep 16–30, 2026",
      periodStart: "2026-09-16",
      periodEnd: "2026-09-30",
      scopeLabel: "Unit A",
      scopeOrgUnitId: unitA.id,
      status: "Draft",
      payDate: "2026-09-30",
    }).returning();

    await enqueuePayrollRun(run.id, 25);
    await drainPayrollQueue(10, run.id);

    const entries = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].employeeId, inScope.id);

    const trace = entries[0].trace as { inputs?: string[] };
    assert.ok(trace.inputs?.includes("punches=1"), `expected only one in-period punch, got ${JSON.stringify(trace.inputs)}`);

    const [finished] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, run.id));
    assert.equal(finished.employeeCount, 1);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("failed settlement rolls back every earlier ledger mutation", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Payroll Settlement Rollback Test",
    legalName: "Payroll Settlement Rollback Test Inc.",
    plan: "Core",
  }).returning();

  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "ROLL-001",
      firstName: "Rollback",
      lastName: "Tester",
      title: "Associate",
      avatarInitials: "RT",
      basicRate: "30000.00",
      bankAccount: "1234567890",
      bankCode: "BDO",
      startDate: "2025-01-01",
    }).returning();

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Sep 16–30, 2026",
      periodStart: "2026-09-16",
      periodEnd: "2026-09-30",
      scopeLabel: "All locations",
      status: "Releasing",
      payDate: "2026-09-30",
      employeeCount: 1,
    }).returning();

    const [claim] = await db.insert(expenseClaims).values({
      organizationId: org.id,
      employeeId: employee.id,
      category: "Transport",
      description: "Client travel",
      amount: "500.00",
      incurredOn: "2026-09-20",
      status: "approved",
    }).returning();

    const [loan] = await db.insert(employeeLoans).values({
      organizationId: org.id,
      employeeId: employee.id,
      loanType: "Company Loan",
      referenceNo: "ROLLBACK-LOAN",
      principal: "5000.00",
      monthlyAmortization: "1000.00",
      cutoffDeduction: "500.00",
      remainingBalance: "5000.00",
      totalPaid: "0.00",
      status: "paused",
      startDate: "2026-01-01",
    }).returning();

    await db.insert(payrollEntries).values({
      payrollRunId: run.id,
      employeeId: employee.id,
      grossPay: "15500.00",
      deductions: "500.00",
      netPay: "15000.00",
      status: "Ready",
      lineItems: [
        { code: `EXP-${claim.id}`, label: "Expense reimbursement", amount: "500.00" },
        { code: `LOAN-${loan.id}`, label: "Loan deduction", amount: "-500.00" },
      ],
      trace: {
        inputs: [`holidayCalendarFingerprint=${holidayCalendarFingerprint(NATIONAL_HOLIDAYS_2026)}`],
        payment: {
          employeeName: "Rollback Tester",
          employeeNo: "ROLL-001",
          bankAccount: "1234567890",
          bankCode: "BDO",
          mobile: null,
        },
        payProfile: {
          payBasis: "monthly",
          rateAmount: 30000,
          standardWorkDaysPerMonth: 22,
          standardHoursPerDay: 8,
          monthlyEquivalent: 30000,
        },
      },
    });

    await assert.rejects(() => settlePayrollRun(run.id), /no longer active/);

    const [claimAfter] = await db.select().from(expenseClaims).where(eq(expenseClaims.id, claim.id));
    assert.equal(claimAfter.status, "approved");
    assert.equal(claimAfter.payrollRunId, null);

    const payments = await db.select().from(loanPayments).where(eq(loanPayments.loanId, loan.id));
    assert.equal(payments.length, 0);

    const [runAfter] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, run.id));
    assert.equal(runAfter.status, "Releasing");
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});


test("targeted queue drain never processes an older unrelated payroll run", async () => {
  const [orgA, orgB] = await db.insert(organizations).values([
    { name: "Queue Target A", legalName: "Queue Target A Inc.", plan: "Core" },
    { name: "Queue Target B", legalName: "Queue Target B Inc.", plan: "Core" },
  ]).returning();

  try {
    const [employeeA] = await db.insert(employees).values({
      organizationId: orgA.id,
      employeeNo: "QUEUE-A-001",
      firstName: "Target",
      lastName: "A",
      title: "Associate",
      avatarInitials: "TA",
      basicRate: "30000.00",
      startDate: "2025-01-01",
    }).returning();
    const [employeeB] = await db.insert(employees).values({
      organizationId: orgB.id,
      employeeNo: "QUEUE-B-001",
      firstName: "Older",
      lastName: "B",
      title: "Associate",
      avatarInitials: "OB",
      basicRate: "30000.00",
      startDate: "2025-01-01",
    }).returning();

    const [runB] = await db.insert(payrollRuns).values({
      organizationId: orgB.id,
      periodLabel: "Sep 1–15, 2026",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-15",
      scopeLabel: "All locations",
      status: "Draft",
      payDate: "2026-09-15",
    }).returning();
    const [runA] = await db.insert(payrollRuns).values({
      organizationId: orgA.id,
      periodLabel: "Sep 16–30, 2026",
      periodStart: "2026-09-16",
      periodEnd: "2026-09-30",
      scopeLabel: "All locations",
      status: "Draft",
      payDate: "2026-09-30",
    }).returning();

    // Queue B first so the old global worker would have processed it before A.
    await enqueuePayrollRun(runB.id, 25);
    await enqueuePayrollRun(runA.id, 25);

    const drained = await drainPayrollQueue(10, runA.id);
    assert.ok(drained.length > 0);
    assert.ok(drained.every((result) => result.processed));

    const entriesA = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, runA.id));
    const entriesB = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, runB.id));
    assert.equal(entriesA.length, 1);
    assert.equal(entriesA[0].employeeId, employeeA.id);
    assert.equal(entriesB.length, 0, "unrelated older run must remain untouched");

    const [freshA] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runA.id));
    const [freshB] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runB.id));
    assert.equal(freshA.status, "Needs review");
    assert.equal(freshB.status, "Queued");
    assert.equal(freshB.employeeCount, 1);
    void employeeB;
  } finally {
    await db.delete(organizations).where(eq(organizations.id, orgA.id));
    await db.delete(organizations).where(eq(organizations.id, orgB.id));
  }
});


test("concurrent payroll review submissions create only one pending approval", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Payroll Submit Race Test",
    legalName: "Payroll Submit Race Test Inc.",
    plan: "Core",
  }).returning();

  try {
    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Sep 16–30, 2026",
      periodStart: "2026-09-16",
      periodEnd: "2026-09-30",
      scopeLabel: "All locations",
      status: "Needs review",
      payDate: "2026-09-30",
    }).returning();

    const submit = async (approver: string) => db.transaction(async (tx) => {
      const [claimed] = await tx.update(payrollRuns)
        .set({ status: "Pending approval" })
        .where(and(
          eq(payrollRuns.id, run.id),
          eq(payrollRuns.status, "Needs review"),
        ))
        .returning();

      if (!claimed) return null;

      const [task] = await tx.insert(approvalTasks).values({
        organizationId: org.id,
        title: "Review payroll",
        detail: `Payroll run #${run.id} · concurrency test`,
        approver,
        dueLabel: "Required before release",
        priority: "Normal",
      }).returning();
      return task;
    });

    const results = await Promise.all([
      submit("Checker A"),
      submit("Checker B"),
    ]);

    assert.equal(results.filter(Boolean).length, 1, "only one submission may claim the run");
    const tasks = await db.select().from(approvalTasks).where(eq(approvalTasks.organizationId, org.id));
    assert.equal(tasks.filter((task) => task.detail.includes(`Payroll run #${run.id}`)).length, 1);

    const [fresh] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, run.id));
    assert.equal(fresh.status, "Pending approval");
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("concurrent payroll approval decisions allow only one final decision", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Payroll Decision Race Test",
    legalName: "Payroll Decision Race Test Inc.",
    plan: "Core",
  }).returning();

  try {
    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Sep 16–30, 2026",
      periodStart: "2026-09-16",
      periodEnd: "2026-09-30",
      scopeLabel: "All locations",
      status: "Pending approval",
      payDate: "2026-09-30",
    }).returning();

    const [task] = await db.insert(approvalTasks).values({
      organizationId: org.id,
      title: "Review payroll",
      detail: `Payroll run #${run.id} · concurrency test`,
      approver: "Checker",
      dueLabel: "Required before release",
      priority: "Normal",
    }).returning();

    const decide = async (decision: "Approved" | "Declined") => {
      try {
        return await db.transaction(async (tx) => {
          const [updatedRun] = await tx.update(payrollRuns)
            .set({ status: decision === "Approved" ? "Ready for release" : "Needs review" })
            .where(and(
              eq(payrollRuns.id, run.id),
              eq(payrollRuns.status, "Pending approval"),
            ))
            .returning();
          if (!updatedRun) return null;

          const [updatedTask] = await tx.update(approvalTasks)
            .set({ status: decision, decidedBy: "Checker", decidedAt: new Date() })
            .where(and(
              eq(approvalTasks.id, task.id),
              eq(approvalTasks.status, "Pending"),
            ))
            .returning();
          if (!updatedTask) throw new Error("task conflict");

          return { decision, updatedRun, updatedTask };
        });
      } catch (error) {
        if (error instanceof Error && error.message === "task conflict") return null;
        throw error;
      }
    };

    const results = await Promise.all([
      decide("Approved"),
      decide("Declined"),
    ]);
    const winner = results.find(Boolean);
    assert.ok(winner, "one decision must win");
    assert.equal(results.filter(Boolean).length, 1, "a second simultaneous decision must lose");

    const [freshRun] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, run.id));
    const [freshTask] = await db.select().from(approvalTasks).where(eq(approvalTasks.id, task.id));
    assert.equal(freshTask.status, winner!.decision);
    assert.equal(
      freshRun.status,
      winner!.decision === "Approved" ? "Ready for release" : "Needs review",
    );
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("two releases cannot settle the same expense claim into different payroll runs", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Payroll Concurrent Settlement Test",
    legalName: "Payroll Concurrent Settlement Test Inc.",
    plan: "Core",
  }).returning();

  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "SETTLE-RACE-001",
      firstName: "Settlement",
      lastName: "Race",
      title: "Associate",
      avatarInitials: "SR",
      basicRate: "30000.00",
      bankAccount: "2234567890",
      bankCode: "BPI",
      startDate: "2025-01-01",
    }).returning();

    const [claim] = await db.insert(expenseClaims).values({
      organizationId: org.id,
      employeeId: employee.id,
      category: "Transport",
      description: "Shared stale claim",
      amount: "500.00",
      incurredOn: "2026-09-20",
      status: "approved",
    }).returning();

    const [runA, runB] = await db.insert(payrollRuns).values([
      {
        organizationId: org.id,
        periodLabel: "Sep 16–30, 2026 A",
        periodStart: "2026-09-16",
        periodEnd: "2026-09-30",
        scopeLabel: "All locations",
        status: "Releasing",
        payDate: "2026-09-30",
        employeeCount: 1,
      },
      {
        organizationId: org.id,
        periodLabel: "Sep 16–30, 2026 B",
        periodStart: "2026-09-16",
        periodEnd: "2026-09-30",
        scopeLabel: "All locations",
        status: "Releasing",
        payDate: "2026-09-30",
        employeeCount: 1,
      },
    ]).returning();

    for (const run of [runA, runB]) {
      await db.insert(payrollEntries).values({
        payrollRunId: run.id,
        employeeId: employee.id,
        grossPay: "15500.00",
        deductions: "0.00",
        netPay: "15500.00",
        status: "Ready",
        lineItems: [
          { code: `EXP-${claim.id}`, label: "Expense reimbursement", amount: "500.00" },
        ],
        trace: {
          inputs: [`holidayCalendarFingerprint=${holidayCalendarFingerprint(NATIONAL_HOLIDAYS_2026)}`],
          payment: {
            employeeName: "Settlement Race",
            employeeNo: "SETTLE-RACE-001",
            bankAccount: "2234567890",
            bankCode: "BPI",
            mobile: null,
          },
          payProfile: {
            payBasis: "monthly",
            rateAmount: 30000,
            standardWorkDaysPerMonth: 22,
            standardHoursPerDay: 8,
            monthlyEquivalent: 30000,
          },
        },
      });
    }

    const results = await Promise.allSettled([
      settlePayrollRun(runA.id),
      settlePayrollRun(runB.id),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);

    const [claimAfter] = await db.select().from(expenseClaims).where(eq(expenseClaims.id, claim.id));
    assert.ok(claimAfter.payrollRunId === runA.id || claimAfter.payrollRunId === runB.id);
    assert.equal(claimAfter.status, "paid");

    const freshRuns = await db.select().from(payrollRuns).where(eq(payrollRuns.organizationId, org.id));
    assert.equal(freshRuns.filter((run) => run.status === "Released").length, 1);
    assert.equal(freshRuns.filter((run) => run.status === "Releasing").length, 1);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});


test("seeded payroll lifecycle recalculates cleanly and releases overtime, leave conversion, loan and export data", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Payroll Lifecycle QA",
    legalName: "Payroll Lifecycle QA Inc.",
    plan: "Core",
  }).returning();

  let templateId: number | null = null;

  try {
    const [activeEmployee, inactiveEmployee] = await db.insert(employees).values([
      {
        organizationId: org.id,
        employeeNo: "LIFE-001",
        firstName: "Lifecycle",
        lastName: "Active",
        title: "Payroll QA",
        avatarInitials: "LA",
        basicRate: "44000.00",
        bankAccount: "9988776655",
        bankCode: "BPI",
        mobile: "09171234567",
        email: "lifecycle-active@example.test",
        startDate: "2025-01-01",
        status: "Active",
      },
      {
        organizationId: org.id,
        employeeNo: "LIFE-002",
        firstName: "Lifecycle",
        lastName: "Inactive",
        title: "Payroll QA",
        avatarInitials: "LI",
        basicRate: "44000.00",
        bankAccount: "1122334455",
        bankCode: "BPI",
        startDate: "2025-01-01",
        status: "Inactive",
      },
    ]).returning();

    const [loan] = await db.insert(employeeLoans).values({
      organizationId: org.id,
      employeeId: activeEmployee.id,
      loanType: "Company Loan",
      referenceNo: "LIFE-LOAN-001",
      principal: "3000.00",
      monthlyAmortization: "1200.00",
      cutoffDeduction: "600.00",
      remainingBalance: "3000.00",
      totalPaid: "0.00",
      status: "active",
      startDate: "2026-01-01",
    }).returning();

    const [leaveConversion] = await db.insert(leaveConversions).values({
      organizationId: org.id,
      employeeId: activeEmployee.id,
      leaveType: "Service Incentive Leave",
      daysConverted: "1.0",
      dailyRate: "2000.00",
      cashAmount: "2000.00",
      taxExempt: true,
      status: "approved",
    }).returning();

    const [overtimePunch] = await db.insert(timePunches).values({
      organizationId: org.id,
      employeeId: activeEmployee.id,
      workDate: "2026-09-20",
      timeIn: new Date("2026-09-20T09:00:00+08:00"),
      timeOut: new Date("2026-09-20T20:00:00+08:00"),
      // Evidence of the actual non-payable meal break is required when
      // attendance crosses ordinary/OT premium boundaries.
      breakStart: new Date("2026-09-20T12:00:00+08:00"),
      breakEnd: new Date("2026-09-20T13:00:00+08:00"),
      shiftStart: "09:00",
      shiftEnd: "18:00",
      status: "Complete",
    }).returning();

    await db.insert(timePunches).values({
      organizationId: org.id,
      employeeId: inactiveEmployee.id,
      workDate: "2026-09-20",
      timeIn: new Date("2026-09-20T09:00:00+08:00"),
      timeOut: new Date("2026-09-20T23:00:00+08:00"),
      shiftStart: "09:00",
      shiftEnd: "18:00",
      status: "Complete",
    });

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Sep 16–30, 2026 lifecycle QA",
      periodStart: "2026-09-16",
      periodEnd: "2026-09-30",
      scopeLabel: "All locations",
      status: "Draft",
      payDate: "2026-09-30",
    }).returning();

    await enqueuePayrollRun(run.id, 25);
    await drainPayrollQueue(10, run.id);

    let entries = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
    assert.equal(entries.length, 1, "inactive employees must never enter a regular payroll register");
    assert.equal(entries[0].employeeId, activeEmployee.id);

    const firstEntryId = entries[0].id;
    const firstLines = entries[0].lineItems as Array<{ code: string; amount: string }>;
    const firstOt = firstLines.find((line) => line.code === "OT");
    const firstLoan = firstLines.find((line) => line.code === `LOAN-${loan.id}`);
    const firstLeave = firstLines.find((line) => line.code === `LEAVE_CONV-${leaveConversion.id}`);

    assert.ok(firstOt && Number(firstOt.amount) > 0, "overtime must be present in the calculated register");
    assert.equal(Number(firstLoan?.amount), -600);
    assert.equal(Number(firstLeave?.amount), 2000);
    const firstTrace = entries[0].trace as { inputs?: string[] };
    assert.ok(firstTrace.inputs?.includes("leaveConversionTaxExempt=2000.00"));

    const firstPayslips = await db.select().from(payslips).where(eq(payslips.payrollEntryId, firstEntryId));
    assert.equal(firstPayslips.length, 1);

    const assurance = await buildPayrollAssurance(run.id);
    assert.ok(assurance);
    assert.equal(assurance!.assurance.summary.blocking, 0, "the seeded run must pass payroll assurance before approval");

    await db.update(timePunches)
      .set({ timeOut: new Date("2026-09-20T18:00:00+08:00") })
      .where(eq(timePunches.id, overtimePunch.id));
    await db.update(employeeLoans)
      .set({ cutoffDeduction: "400.00" })
      .where(eq(employeeLoans.id, loan.id));

    await enqueuePayrollRun(run.id, 25);
    await drainPayrollQueue(10, run.id);

    const oldEntries = await db.select().from(payrollEntries).where(eq(payrollEntries.id, firstEntryId));
    const oldPayslips = await db.select().from(payslips).where(eq(payslips.payrollEntryId, firstEntryId));
    assert.equal(oldEntries.length, 0, "recalculation must replace the previous register");
    assert.equal(oldPayslips.length, 0, "recalculation must cascade-delete stale payslips");

    entries = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
    assert.equal(entries.length, 1);
    const replacementLines = entries[0].lineItems as Array<{ code: string; amount: string }>;
    assert.equal(replacementLines.some((line) => line.code === "OT" && Number(line.amount) > 0), false);
    assert.equal(Number(replacementLines.find((line) => line.code === `LOAN-${loan.id}`)?.amount), -400);
    assert.equal(Number(replacementLines.find((line) => line.code === `LEAVE_CONV-${leaveConversion.id}`)?.amount), 2000);

    const [freshRun] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, run.id));
    assert.equal(freshRun.employeeCount, 1);
    assert.equal(freshRun.status, "Needs review");

    const assuranceAfterRecalc = await buildPayrollAssurance(run.id);
    assert.ok(assuranceAfterRecalc);
    assert.equal(assuranceAfterRecalc!.assurance.summary.blocking, 0);

    await db.update(payrollRuns).set({ status: "Releasing" }).where(eq(payrollRuns.id, run.id));
    const released = await settlePayrollRun(run.id);
    assert.equal(released.run.status, "Released");
    assert.equal(released.settlement.loanPaymentsSettled, 1);
    assert.equal(released.settlement.leaveConversionsSettled, 1);

    const [loanAfter] = await db.select().from(employeeLoans).where(eq(employeeLoans.id, loan.id));
    assert.equal(Number(loanAfter.remainingBalance), 2600);
    assert.equal(Number(loanAfter.totalPaid), 400);

    const [conversionAfter] = await db.select().from(leaveConversions).where(eq(leaveConversions.id, leaveConversion.id));
    assert.equal(conversionAfter.status, "paid");
    assert.equal(conversionAfter.payrollRunId, run.id);

    const [template] = await db.insert(bankTemplates).values({
      name: `Lifecycle QA Bank ${org.id}`,
      version: "1",
      format: "CSV",
      mappings: {
        columns: ["account_number", "employee_name", "net_pay", "employee_no"],
        headers: {
          account_number: "account_number",
          employee_name: "employee_name",
          net_pay: "net_pay",
          employee_no: "employee_no",
        },
        delimiter: ",",
        includeHeader: true,
        lineEnding: "LF",
      },
      active: true,
    }).returning();
    templateId = template.id;

    const bank = await generateBankFile(run.id, template.name, false);
    assert.equal(bank.validation.dryRun, false);
    assert.equal(bank.validation.rowCount, 1);
    assert.equal(bank.validation.missingPaymentSnapshots, 0);
    assert.equal(Number(bank.validation.totalNet), Number(released.run.netPay));
    assert.ok(bank.body.includes(activeEmployee.employeeNo));
    assert.equal(bank.body.includes(inactiveEmployee.employeeNo), false);
  } finally {
    if (templateId) await db.delete(bankTemplates).where(eq(bankTemplates.id, templateId));
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});


test("leave days crossing a cutoff are allocated deterministically", () => {
  const request = {
    id: 1,
    leaveType: "Annual leave",
    startDate: "2026-09-14",
    endDate: "2026-09-18",
    days: 5,
  };
  assert.equal(allocateLeaveDaysToPeriod(request, "2026-09-01", "2026-09-15"), 2);
  assert.equal(allocateLeaveDaysToPeriod(request, "2026-09-16", "2026-09-30"), 3);
});

test("approved paid, unpaid and partially paid leave flows into payroll without double deduction", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Leave Payroll Treatment Test",
    legalName: "Leave Payroll Treatment Test Inc.",
    plan: "Core",
  }).returning();

  try {
    const [paidEmployee, unpaidEmployee, partialEmployee] = await db.insert(employees).values([
      {
        organizationId: org.id,
        employeeNo: "LEAVE-PAID",
        firstName: "Paid",
        lastName: "Leave",
        title: "Associate",
        avatarInitials: "PL",
        basicRate: "22000.00",
        startDate: "2025-01-01",
      },
      {
        organizationId: org.id,
        employeeNo: "LEAVE-UNPAID",
        firstName: "Unpaid",
        lastName: "Leave",
        title: "Associate",
        avatarInitials: "UL",
        basicRate: "22000.00",
        startDate: "2025-01-01",
      },
      {
        organizationId: org.id,
        employeeNo: "LEAVE-PARTIAL",
        firstName: "Partial",
        lastName: "Leave",
        title: "Associate",
        avatarInitials: "HL",
        basicRate: "22000.00",
        startDate: "2025-01-01",
      },
    ]).returning();

    await db.insert(leavePolicies).values([
      {
        organizationId: org.id,
        leaveType: "Annual leave",
        annualDays: "15.0",
        payTreatment: "paid",
        paidPercentage: "100.00",
      },
      {
        organizationId: org.id,
        leaveType: "Unpaid leave",
        annualDays: "365.0",
        payTreatment: "unpaid",
        paidPercentage: "0.00",
      },
      {
        organizationId: org.id,
        leaveType: "Study leave",
        annualDays: "10.0",
        payTreatment: "partial",
        paidPercentage: "50.00",
      },
    ]);

    const [paidLeave, unpaidLeave, partialLeave] = await db.insert(leaveRequests).values([
      {
        organizationId: org.id,
        employeeId: paidEmployee.id,
        leaveType: "Annual leave",
        startDate: "2026-09-14",
        endDate: "2026-09-18",
        days: "5.0",
        reason: "Cross-cutoff paid leave",
        status: "Approved",
      },
      {
        organizationId: org.id,
        employeeId: unpaidEmployee.id,
        leaveType: "Unpaid leave",
        startDate: "2026-09-21",
        endDate: "2026-09-21",
        days: "1.0",
        reason: "Personal",
        status: "Approved",
      },
      {
        organizationId: org.id,
        employeeId: partialEmployee.id,
        leaveType: "Study leave",
        startDate: "2026-09-22",
        endDate: "2026-09-22",
        days: "1.0",
        reason: "Exam",
        status: "Approved",
      },
    ]).returning();

    await db.insert(timePunches).values({
      organizationId: org.id,
      employeeId: paidEmployee.id,
      workDate: "2026-09-21",
      timeIn: new Date("2026-09-21T09:00:00+08:00"),
      timeOut: new Date("2026-09-21T18:00:00+08:00"),
      shiftStart: "09:00",
      shiftEnd: "18:00",
      status: "Complete",
    });

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Sep 16–30, 2026 leave treatment",
      periodStart: "2026-09-16",
      periodEnd: "2026-09-30",
      scopeLabel: "All locations",
      status: "Draft",
      payDate: "2026-09-30",
    }).returning();

    await enqueuePayrollRun(run.id, 25);
    await drainPayrollQueue(10, run.id);

    const entries = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
    assert.equal(entries.length, 3);

    const paidEntry = entries.find((entry) => entry.employeeId === paidEmployee.id)!;
    const unpaidEntry = entries.find((entry) => entry.employeeId === unpaidEmployee.id)!;
    const partialEntry = entries.find((entry) => entry.employeeId === partialEmployee.id)!;

    const paidLines = paidEntry.lineItems as Array<{ code: string; amount: string }>;
    const unpaidLines = unpaidEntry.lineItems as Array<{ code: string; amount: string }>;
    const partialLines = partialEntry.lineItems as Array<{ code: string; amount: string }>;

    assert.equal(
      paidLines.some((line) => line.code === `LEAVE-${paidLeave.id}`),
      false,
      "monthly paid leave is already included in the fixed cutoff salary and must not be added again",
    );
    assert.equal(
      Number(paidLines.find((line) => line.code === "BASIC")?.amount),
      11000,
      "monthly salaried basic remains the full semi-monthly amount even when attendance exists",
    );
    assert.equal(Number(paidEntry.grossPay), 11000, "paid leave does not double-pay a monthly salaried employee");

    assert.equal(
      Number(unpaidLines.find((line) => line.code === `LEAVE-${unpaidLeave.id}`)?.amount),
      -1000,
    );
    assert.equal(Number(unpaidEntry.grossPay), 10000, "one unpaid day reduces the full semi-monthly basic");

    assert.equal(
      Number(partialLines.find((line) => line.code === `LEAVE-${partialLeave.id}`)?.amount),
      -500,
    );
    assert.equal(Number(partialEntry.grossPay), 10500, "50% paid leave only reduces the unpaid half-day value");

    const paidTrace = paidEntry.trace as { inputs?: string[]; flags?: string[] };
    assert.ok(paidTrace.inputs?.includes("approvedLeaveDays=3.00"));
    assert.ok(paidTrace.inputs?.includes("paidLeaveDays=3.00"));
    assert.equal((paidTrace.flags ?? []).some((flag) => flag.includes("Attendance overlaps")), false);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("payroll fails closed when approved leave has no configured payroll treatment", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Leave Payroll Fail Closed",
    legalName: "Leave Payroll Fail Closed Inc.",
    plan: "Core",
  }).returning();

  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "LEAVE-UNCONFIGURED",
      firstName: "Needs",
      lastName: "Policy",
      title: "Associate",
      avatarInitials: "NP",
      basicRate: "22000.00",
      startDate: "2025-01-01",
    }).returning();

    await db.insert(leavePolicies).values({
      organizationId: org.id,
      leaveType: "Special leave",
      annualDays: "5.0",
      payTreatment: "unconfigured",
      paidPercentage: "100.00",
    });

    await db.insert(leaveRequests).values({
      organizationId: org.id,
      employeeId: employee.id,
      leaveType: "Special leave",
      startDate: "2026-09-21",
      endDate: "2026-09-21",
      days: "1.0",
      reason: "Needs policy decision",
      status: "Approved",
    });

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Sep 16–30, 2026 leave fail closed",
      periodStart: "2026-09-16",
      periodEnd: "2026-09-30",
      scopeLabel: "All locations",
      status: "Draft",
      payDate: "2026-09-30",
    }).returning();

    await enqueuePayrollRun(run.id, 25);
    await assert.rejects(
      () => drainPayrollQueue(10, run.id),
      /has no configured payroll treatment/,
    );

    const [failed] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, run.id));
    assert.equal(failed.status, "Failed");
    const entries = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
    assert.equal(entries.length, 0, "an ambiguous approved leave must not produce a guessed payroll entry");
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});
