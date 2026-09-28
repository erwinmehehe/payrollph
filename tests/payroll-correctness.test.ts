import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  employeeLoans,
  employees,
  expenseClaims,
  loanPayments,
  organizations,
  orgUnits,
  payrollEntries,
  payrollRuns,
  timePunches,
} from "../src/db/schema";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";
import { settlePayrollRun } from "../src/lib/payroll-settlement";

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
    await drainPayrollQueue(10);

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
      trace: {},
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
