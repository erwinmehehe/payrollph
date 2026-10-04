import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  employeePayProfiles,
  employees,
  organizations,
  payrollEntries,
  payrollRuns,
  supplementaryEarnings,
  yearEndAdjustments,
} from "../src/db/schema";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";
import { settlePayrollRun } from "../src/lib/payroll-settlement";
import { generateGovernmentDraft, generateJournalCsv } from "../src/lib/exporters";
import { computePagIbig, computePhilHealth, computeSss } from "../src/lib/payroll-rules";
import { runYearEndAnnualization } from "../src/lib/year-end";

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

function lines(entry: typeof payrollEntries.$inferSelect) {
  return Array.isArray(entry.lineItems)
    ? entry.lineItems as Array<{ code?: string; amount?: string | number }>
    : [];
}

async function addMonthlyEmployee(organizationId: number, employeeNo: string, monthlyRate: number) {
  const [employee] = await db.insert(employees).values({
    organizationId,
    employeeNo,
    firstName: "Audit",
    lastName: employeeNo,
    title: "Associate",
    avatarInitials: "AU",
    basicRate: monthlyRate.toFixed(2),
    restDay: "Sunday",
    pagIbigNo: "123456789012",
    mobile: "09171234567",
    startDate: "2025-01-01",
  }).returning();
  await db.insert(employeePayProfiles).values({
    organizationId,
    employeeId: employee.id,
    payBasis: "monthly",
    rateAmount: monthlyRate.toFixed(2),
    standardWorkDaysPerMonth: "22",
    standardHoursPerDay: "8",
  });
  return employee;
}

async function calculateRun(input: {
  organizationId: number;
  label: string;
  start: string;
  end: string;
  payDate: string;
}) {
  const [run] = await db.insert(payrollRuns).values({
    organizationId: input.organizationId,
    periodLabel: input.label,
    periodStart: input.start,
    periodEnd: input.end,
    scopeLabel: "All locations",
    status: "Draft",
    payDate: input.payDate,
  }).returning();
  await enqueuePayrollRun(run.id);
  await drainPayrollQueue(20, run.id);
  const [fresh] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, run.id));
  assert.equal(fresh.status, "Needs review");
  return fresh;
}

async function releaseRun(runId: number) {
  await db.update(payrollRuns).set({ status: "Releasing" }).where(eq(payrollRuns.id, runId));
  return settlePayrollRun(runId, { actor: "Audit", resource: `Run #${runId}` });
}

test("employer statutory shares follow first-cutoff timing instead of hard-coded 50/50", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Employer Cutoff Audit",
    legalName: "Employer Cutoff Audit Inc.",
    plan: "Core",
    statutoryDeductionTiming: "first_cutoff",
  }).returning();

  try {
    const employee = await addMonthlyEmployee(org.id, "ER-CUTOFF-001", 20_000);
    const first = await calculateRun({
      organizationId: org.id,
      label: "Oct 1-15 employer cutoff audit",
      start: "2026-10-01",
      end: "2026-10-15",
      payDate: "2026-10-15",
    });
    const [firstEntry] = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, first.id));
    const sssBase = traceValue(firstEntry.trace, "statutoryMonthlySssCompensation")!;
    const phBase = traceValue(firstEntry.trace, "philHealthContributionBase")!;
    const hdmfBase = traceValue(firstEntry.trace, "statutoryMonthlyPagIbigCompensation")!;
    const sss = computeSss(sssBase);
    const ph = computePhilHealth(phBase);
    const hdmf = computePagIbig(hdmfBase);

    assert.equal(traceValue(firstEntry.trace, "sssEmployerCutoff"), sss.employer);
    assert.equal(traceValue(firstEntry.trace, "sssEmployerEcCutoff"), sss.employerEC);
    assert.equal(traceValue(firstEntry.trace, "philHealthEmployerCutoff"), ph.employer);
    assert.equal(traceValue(firstEntry.trace, "pagIbigEmployerCutoff"), hdmf.employer);

    const journal = await generateJournalCsv(first.id);
    assert.equal(
      journal.summary.employerStatutoryExpense,
      sss.employer + sss.employerEC + ph.employer + hdmf.employer,
    );

    await releaseRun(first.id);

    const second = await calculateRun({
      organizationId: org.id,
      label: "Oct 16-31 employer cutoff audit",
      start: "2026-10-16",
      end: "2026-10-31",
      payDate: "2026-10-31",
    });
    const [secondEntry] = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, second.id));
    assert.equal(traceValue(secondEntry.trace, "sssEmployerCutoff"), 0);
    assert.equal(traceValue(secondEntry.trace, "sssEmployerEcCutoff"), 0);
    assert.equal(traceValue(secondEntry.trace, "philHealthEmployerCutoff"), 0);
    assert.equal(traceValue(secondEntry.trace, "pagIbigEmployerCutoff"), 0);
    assert.equal(secondEntry.employeeId, employee.id);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("Pag-IBIG monthly worksheet uses its dedicated compensation base, not the SSS base", async () => {
  const [org] = await db.insert(organizations).values({
    name: "HDMF Base Audit",
    legalName: "HDMF Base Audit Inc.",
    plan: "Core",
  }).returning();

  try {
    const employee = await addMonthlyEmployee(org.id, "HDMF-BASE-001", 1_000);

    const first = await calculateRun({
      organizationId: org.id,
      label: "Oct 1-15 HDMF base audit",
      start: "2026-10-01",
      end: "2026-10-15",
      payDate: "2026-10-15",
    });
    await releaseRun(first.id);

    await db.insert(supplementaryEarnings).values({
      organizationId: org.id,
      employeeId: employee.id,
      earningType: "commission",
      label: "SSS-only remuneration",
      amount: "5000.00",
      taxable: true,
      includeInSssBase: true,
      includeInPagIbigBase: false,
      effectiveDate: "2026-10-20",
      status: "approved",
      createdBy: "Audit",
    });

    const second = await calculateRun({
      organizationId: org.id,
      label: "Oct 16-31 HDMF base audit",
      start: "2026-10-16",
      end: "2026-10-31",
      payDate: "2026-10-31",
    });
    const [entry] = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, second.id));
    const sssBase = traceValue(entry.trace, "statutoryMonthlySssCompensation")!;
    const hdmfBase = traceValue(entry.trace, "statutoryMonthlyPagIbigCompensation")!;
    assert.ok(sssBase > hdmfBase);
    assert.equal(hdmfBase, 1000);

    const draft = await generateGovernmentDraft(second.id, "pagibig-mcrf");
    assert.match(draft.body, /HDMF-BASE-001|Audit/);
    const dataRow = draft.body.split("\n").find((row) => row.includes("123456789012"));
    assert.ok(dataRow);
    const columns = dataRow!.split(",").map((cell) => cell.replace(/^"|"$/g, ""));
    assert.equal(Number(columns[11]), computePagIbig(hdmfBase).fundSalary);
    assert.equal(Number(columns[11]), 1000);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("year-end refund or collection is bound to final payroll and settled atomically on release", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Year End Settlement Audit",
    legalName: "Year End Settlement Audit Inc.",
    plan: "Core",
  }).returning();

  try {
    const employee = await addMonthlyEmployee(org.id, "YE-TAX-001", 30_000);

    const [priorRun] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Prior 2026 payroll history",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-15",
      scopeLabel: "All locations",
      status: "Released",
      payDate: "2026-01-15",
      employeeCount: 1,
      grossPay: "500000.00",
      netPay: "390000.00",
      ruleVersion: "PH-2026.05",
    }).returning();
    await db.insert(payrollEntries).values({
      payrollRunId: priorRun.id,
      employeeId: employee.id,
      grossPay: "500000.00",
      deductions: "110000.00",
      netPay: "390000.00",
      status: "Ready",
      lineItems: [
        { code: "BASIC", label: "Basic / worked pay", amount: "500000.00" },
        { code: "SSS", label: "SSS contribution", amount: "-1750.00" },
        { code: "PHIC", label: "PhilHealth contribution", amount: "-2500.00" },
        { code: "HDMF", label: "Pag-IBIG mandatory contribution", amount: "-200.00" },
        { code: "WHT", label: "Withholding tax", amount: "-105550.00" },
      ],
      trace: { inputs: [] },
    });

    const finalRun = await calculateRun({
      organizationId: org.id,
      label: "Dec 16-31 year-end settlement",
      start: "2026-12-16",
      end: "2026-12-31",
      payDate: "2026-12-31",
    });

    const summary = await runYearEndAnnualization(
      org.id,
      2026,
      "Audit",
      {
        includePayrollRunId: finalRun.id,
        bindToPayrollRunId: finalRun.id,
        approvedBy: "Audit",
      },
    );
    assert.equal(summary.boundPayrollRunId, finalRun.id);

    const [bound] = await db.select().from(yearEndAdjustments).where(and(
      eq(yearEndAdjustments.organizationId, org.id),
      eq(yearEndAdjustments.employeeId, employee.id),
      eq(yearEndAdjustments.payrollRunId, finalRun.id),
    ));
    assert.ok(bound);
    assert.notEqual(Number(bound.adjustment), 0);
    assert.equal(bound.status, "approved");

    await enqueuePayrollRun(finalRun.id);
    await drainPayrollQueue(20, finalRun.id);

    const [entry] = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, finalRun.id));
    const yearEndLine = lines(entry).find((line) => line.code === `YE-TAX-${bound.id}`);
    assert.ok(yearEndLine);
    assert.equal(Number(yearEndLine!.amount), -Number(bound.adjustment));

    const release = await releaseRun(finalRun.id);
    assert.equal(release.run.status, "Released");
    assert.equal(release.settlement.yearEndTaxAdjustmentsSettled, 1);

    const [settled] = await db.select().from(yearEndAdjustments).where(eq(yearEndAdjustments.id, bound.id));
    assert.equal(settled.status, "settled");
    assert.ok(settled.settledAt);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});
