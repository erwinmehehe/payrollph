import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  employees,
  organizations,
  payrollEntries,
  payrollRuns,
  supplementaryEarnings,
  yearEndAdjustments,
} from "../src/db/schema";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";
import { generateGovernmentDraft, generateJournalCsv } from "../src/lib/exporters";
import { settlePayrollRun } from "../src/lib/payroll-settlement";
import { applyYearEndAdjustmentsToPayrollRun } from "../src/lib/year-end";

function traceValue(trace: unknown, key: string) {
  const inputs = trace && typeof trace === "object"
    ? (trace as { inputs?: unknown }).inputs
    : null;
  if (!Array.isArray(inputs)) return null;
  const raw = inputs.find((item) => typeof item === "string" && item.startsWith(`${key}=`));
  if (typeof raw !== "string") return null;
  const value = Number(raw.slice(key.length + 1));
  return Number.isFinite(value) ? value : null;
}

function line(entry: typeof payrollEntries.$inferSelect, prefix: string) {
  const items = Array.isArray(entry.lineItems)
    ? entry.lineItems as Array<{ code?: string; amount?: string | number }>
    : [];
  return items.find((item) => String(item.code ?? "").startsWith(prefix));
}

test("employer statutory accrual follows first-cutoff policy and month-final true-up", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Employer Cutoff Audit",
    legalName: "Employer Cutoff Audit Inc.",
    plan: "Core",
    statutoryDeductionTiming: "first_cutoff",
  }).returning();

  try {
    await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "ER-CUTOFF-001",
      firstName: "Employer",
      lastName: "Cutoff",
      title: "Associate",
      avatarInitials: "EC",
      basicRate: "20000.00",
      restDay: "Sunday",
      startDate: "2025-01-01",
    });

    const [first] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Oct 1-15, 2026 employer cutoff",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-15",
      scopeLabel: "All locations",
      status: "Draft",
      payDate: "2026-10-15",
    }).returning();

    await enqueuePayrollRun(first.id);
    await drainPayrollQueue(10, first.id);
    const [firstEntry] = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, first.id));

    assert.equal(traceValue(firstEntry.trace, "sssEmployerCutoff"), 2000);
    assert.equal(traceValue(firstEntry.trace, "sssEmployerEcCutoff"), 30);
    assert.equal(traceValue(firstEntry.trace, "philHealthEmployerCutoff"), 500);
    assert.equal(traceValue(firstEntry.trace, "pagIbigEmployerCutoff"), 200);
    assert.equal(traceValue(firstEntry.trace, "employerStatutoryCost"), 2730);

    const journal = await generateJournalCsv(first.id);
    assert.equal(journal.summary.employerStatutoryExpense, 2730);

    await db.update(payrollRuns).set({ status: "Releasing" }).where(eq(payrollRuns.id, first.id));
    await settlePayrollRun(first.id, { actor: "Audit", resource: first.periodLabel });

    const [second] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Oct 16-31, 2026 employer cutoff",
      periodStart: "2026-10-16",
      periodEnd: "2026-10-31",
      scopeLabel: "All locations",
      status: "Draft",
      payDate: "2026-10-31",
    }).returning();

    await enqueuePayrollRun(second.id);
    await drainPayrollQueue(10, second.id);
    const [secondEntry] = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, second.id));

    assert.equal(traceValue(secondEntry.trace, "sssEmployerCutoff"), 0);
    assert.equal(traceValue(secondEntry.trace, "sssEmployerEcCutoff"), 0);
    assert.equal(traceValue(secondEntry.trace, "philHealthEmployerCutoff"), 0);
    assert.equal(traceValue(secondEntry.trace, "pagIbigEmployerCutoff"), 0);

    const secondJournal = await generateJournalCsv(second.id);
    assert.equal(secondJournal.summary.employerStatutoryExpense, 0);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("accounting export uses dedicated Pag-IBIG compensation base instead of SSS remuneration", async () => {
  const [org] = await db.insert(organizations).values({
    name: "HDMF Export Base Audit",
    legalName: "HDMF Export Base Audit Inc.",
    plan: "Core",
  }).returning();

  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "HDMF-BASE-001",
      firstName: "HDMF",
      lastName: "Base",
      title: "Associate",
      avatarInitials: "HB",
      basicRate: "1200.00",
      restDay: "Sunday",
      startDate: "2025-01-01",
    }).returning();

    await db.insert(supplementaryEarnings).values({
      organizationId: org.id,
      employeeId: employee.id,
      earningType: "commission",
      label: "SSS-only commission",
      amount: "10000.00",
      taxable: true,
      includeInSssBase: true,
      includeInPagIbigBase: false,
      effectiveDate: "2026-10-10",
      status: "approved",
      createdBy: "Audit",
    });

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Oct 1-15, 2026 HDMF base",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-15",
      scopeLabel: "All locations",
      status: "Draft",
      payDate: "2026-10-15",
    }).returning();

    await enqueuePayrollRun(run.id);
    await drainPayrollQueue(10, run.id);

    const [entry] = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
    assert.ok((traceValue(entry.trace, "statutoryMonthlySssCompensation") ?? 0) > 10000);
    assert.equal(traceValue(entry.trace, "statutoryMonthlyPagIbigCompensation"), 1200);

    const journal = await generateJournalCsv(run.id);
    // Pag-IBIG at PHP 1,200 monthly compensation: EE 1%=12, ER 2%=24.
    // Split cutoff therefore carries PHP 6 EE + PHP 12 ER = PHP 18.
    assert.equal(journal.summary.pagIbig, 18);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("year-end refund and collection are staged into final payroll and consumed only on release", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Year End Settlement Audit",
    legalName: "Year End Settlement Audit Inc.",
    plan: "Core",
  }).returning();

  try {
    const staff = await db.insert(employees).values([
      {
        organizationId: org.id,
        employeeNo: "YE-REFUND-001",
        firstName: "Refund",
        lastName: "Employee",
        title: "Associate",
        avatarInitials: "RE",
        basicRate: "30000.00",
        restDay: "Sunday",
        startDate: "2025-01-01",
      },
      {
        organizationId: org.id,
        employeeNo: "YE-COLLECT-001",
        firstName: "Collect",
        lastName: "Employee",
        title: "Associate",
        avatarInitials: "CE",
        basicRate: "30000.00",
        restDay: "Sunday",
        startDate: "2025-01-01",
      },
    ]).returning();

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Dec 16-31, 2026 year-end",
      periodStart: "2026-12-16",
      periodEnd: "2026-12-31",
      scopeLabel: "All locations",
      status: "Draft",
      payDate: "2026-12-31",
    }).returning();

    await enqueuePayrollRun(run.id);
    await drainPayrollQueue(10, run.id);

    const before = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
    const beforeByEmployee = new Map(before.map((entry) => [entry.employeeId, entry]));

    const [refundAdjustment, collectAdjustment] = await db.insert(yearEndAdjustments).values([
      {
        organizationId: org.id,
        employeeId: staff[0].id,
        taxYear: 2026,
        grossCompensation: "360000.00",
        thirteenthMonth: "30000.00",
        nonTaxable: "50000.00",
        statutoryContributions: "20000.00",
        taxableIncome: "310000.00",
        taxDue: "9000.00",
        taxWithheld: "9500.00",
        adjustment: "-500.00",
        outcome: "refund",
        breakdown: {},
        ruleVersion: "PH-2026.03",
      },
      {
        organizationId: org.id,
        employeeId: staff[1].id,
        taxYear: 2026,
        grossCompensation: "360000.00",
        thirteenthMonth: "30000.00",
        nonTaxable: "50000.00",
        statutoryContributions: "20000.00",
        taxableIncome: "310000.00",
        taxDue: "10000.00",
        taxWithheld: "9500.00",
        adjustment: "500.00",
        outcome: "collect",
        breakdown: {},
        ruleVersion: "PH-2026.03",
      },
    ]).returning();

    const staged = await applyYearEndAdjustmentsToPayrollRun({
      organizationId: org.id,
      taxYear: 2026,
      payrollRunId: run.id,
      actor: "Audit",
    });
    assert.equal(staged.staged, 2);
    assert.equal(staged.totalAdjustment, 0);

    const after = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
    const refundEntry = after.find((entry) => entry.employeeId === staff[0].id)!;
    const collectEntry = after.find((entry) => entry.employeeId === staff[1].id)!;
    assert.equal(Number(line(refundEntry, `YEAR_END_TAX-${refundAdjustment.id}`)?.amount), 500);
    assert.equal(Number(line(collectEntry, `YEAR_END_TAX-${collectAdjustment.id}`)?.amount), -500);
    assert.equal(Number(refundEntry.netPay), Number(beforeByEmployee.get(staff[0].id)!.netPay) + 500);
    assert.equal(Number(collectEntry.netPay), Number(beforeByEmployee.get(staff[1].id)!.netPay) - 500);

    const stagedJournal = await generateJournalCsv(run.id);
    assert.ok(stagedJournal.body.includes("BIR Withholding Tax Payable"));
    assert.ok(Number.isFinite(stagedJournal.summary.birWithholding));

    const preRelease = await db.select().from(yearEndAdjustments).where(eq(yearEndAdjustments.organizationId, org.id));
    assert.ok(preRelease.every((row) => row.appliedPayrollRunId == null && row.appliedAt == null));

    await db.update(payrollRuns).set({ status: "Releasing" }).where(eq(payrollRuns.id, run.id));
    const released = await settlePayrollRun(run.id, { actor: "Audit", resource: run.periodLabel });
    assert.equal(released.settlement.yearEndTaxAdjustmentsSettled, 2);

    const settled = await db.select().from(yearEndAdjustments).where(eq(yearEndAdjustments.organizationId, org.id));
    assert.ok(settled.every((row) => row.appliedPayrollRunId === run.id && row.appliedAt != null));
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});


test("monthly government reports reject first cutoff and aggregate released cutoffs", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Monthly Government Export Audit",
    legalName: "Monthly Government Export Audit Inc.",
    plan: "Core",
  }).returning();

  try {
    await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "GOV-MONTH-001",
      firstName: "Monthly",
      lastName: "Report",
      title: "Associate",
      avatarInitials: "MR",
      basicRate: "20000.00",
      restDay: "Sunday",
      sssNo: "34-1234567-8",
      philHealthNo: "01-234567890-1",
      pagIbigNo: "1234-5678-9012",
      startDate: "2025-01-01",
    });

    const [first] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Nov 1-15, 2026 government report",
      periodStart: "2026-11-01",
      periodEnd: "2026-11-15",
      scopeLabel: "All locations",
      status: "Draft",
      payDate: "2026-11-15",
    }).returning();
    await enqueuePayrollRun(first.id);
    await drainPayrollQueue(10, first.id);
    await db.update(payrollRuns).set({ status: "Releasing" }).where(eq(payrollRuns.id, first.id));
    await settlePayrollRun(first.id, { actor: "Audit", resource: first.periodLabel });

    await assert.rejects(
      generateGovernmentDraft(first.id, "sss-r3"),
      /final cutoff of the month/i,
    );

    const [second] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Nov 16-30, 2026 government report",
      periodStart: "2026-11-16",
      periodEnd: "2026-11-30",
      scopeLabel: "All locations",
      status: "Draft",
      payDate: "2026-11-30",
    }).returning();
    await enqueuePayrollRun(second.id);
    await drainPayrollQueue(10, second.id);
    await db.update(payrollRuns).set({ status: "Releasing" }).where(eq(payrollRuns.id, second.id));
    await settlePayrollRun(second.id, { actor: "Audit", resource: second.periodLabel });

    const sss = await generateGovernmentDraft(second.id, "sss-r3");
    assert.ok(sss.body.includes("20000.00"), "monthly SSS worksheet should reconcile the full month's remuneration");
    assert.equal(sss.body.split("\n").filter((row) => row.startsWith("34-1234567-8")).length, 1);

    const bir = await generateGovernmentDraft(second.id, "bir-1601c");
    assert.ok(bir.body.includes("2026-11"));
    assert.ok(bir.body.includes(",1,DRAFT"));
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});
