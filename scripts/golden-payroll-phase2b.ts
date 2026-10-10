import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import {
  employeeLoans,
  employeePayProfiles,
  employeePayRetroAdjustments,
  employeePayRevisions,
  employees,
  leavePolicies,
  leaveRequests,
  organizations,
  overtimeRequests,
  payrollEntries,
  payrollRuns,
  supplementaryEarnings,
  timePunches,
} from "../src/db/schema";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";
import { computeFinalPay } from "../src/lib/final-pay";

type ExpectedCatalog = {
  version: string;
  tolerancePeso: number;
  cases: Record<string, { description: string; expected: Record<string, any> }>;
  limitations: string[];
};

type PayrollLine = { code?: string; label?: string; amount?: string | number; notes?: string[] };

const catalogPath = "certification/golden-payroll-phase2b.json";
const artifactPath = "qa-artifacts/golden-payroll-phase2b-reconciliation.json";

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function assertMoney(actual: number, expected: number, label: string, tolerance: number) {
  // Compare integer centavos. Binary floating-point subtraction can turn a
  // permitted 1-cent difference into 0.0100000000002 and falsely fail CI.
  const actualCents = Math.round((round2(actual) + Number.EPSILON) * 100);
  const expectedCents = Math.round((round2(expected) + Number.EPSILON) * 100);
  const toleranceCents = Math.floor(tolerance * 100 + 1e-8);
  assert.ok(
    Number.isFinite(actual) && Number.isFinite(expected)
      && Math.abs(actualCents - expectedCents) <= toleranceCents,
    `${label}: expected ₱${Number(expected).toFixed(2)}, got ₱${Number(actual).toFixed(2)}`,
  );
}

function entryLines(entry: typeof payrollEntries.$inferSelect) {
  return Array.isArray(entry.lineItems) ? entry.lineItems as PayrollLine[] : [];
}

function lineAmount(entry: typeof payrollEntries.$inferSelect, code: string) {
  return Number(entryLines(entry).find((item) => String(item.code ?? "") === code)?.amount ?? 0);
}

function lineByLabel(entry: typeof payrollEntries.$inferSelect, label: string) {
  return entryLines(entry).find((item) => String(item.label ?? "") === label);
}

function traceValue(trace: unknown, key: string) {
  if (!trace || typeof trace !== "object") return null;
  const inputs = (trace as { inputs?: unknown }).inputs;
  if (!Array.isArray(inputs)) return null;
  const prefix = `${key}=`;
  const raw = inputs.find((item) => typeof item === "string" && item.startsWith(prefix));
  return typeof raw === "string" ? raw.slice(prefix.length) : null;
}

function traceNumber(trace: unknown, key: string) {
  const raw = traceValue(trace, key);
  const value = raw == null ? Number.NaN : Number(raw);
  return Number.isFinite(value) ? value : Number.NaN;
}

async function createOrg(name: string) {
  const [org] = await db.insert(organizations).values({
    name,
    legalName: `${name} Inc.`,
    plan: "Core",
    statutoryDeductionTiming: "split",
  }).returning();
  return org;
}

async function createMonthlyEmployee(input: {
  organizationId: number;
  employeeNo: string;
  salary: number;
  startDate?: string;
  restDay?: string | null;
}) {
  const [employee] = await db.insert(employees).values({
    organizationId: input.organizationId,
    employeeNo: input.employeeNo,
    firstName: "Golden",
    lastName: input.employeeNo,
    title: "Certification Employee",
    avatarInitials: "GP",
    basicRate: input.salary.toFixed(2),
    startDate: input.startDate ?? "2026-01-01",
    restDay: input.restDay ?? null,
    region: "NCR",
  }).returning();

  await db.insert(employeePayProfiles).values({
    employeeId: employee.id,
    organizationId: input.organizationId,
    payBasis: "monthly",
    rateAmount: input.salary.toFixed(2),
    standardWorkDaysPerMonth: "22.00",
    standardHoursPerDay: "8.00",
  });
  return employee;
}

async function runPayroll(input: {
  organizationId: number;
  label: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
}) {
  const [run] = await db.insert(payrollRuns).values({
    organizationId: input.organizationId,
    periodLabel: input.label,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    scopeLabel: "All locations",
    status: "Draft",
    payDate: input.payDate,
  }).returning();
  await enqueuePayrollRun(run.id, 25);
  await drainPayrollQueue(10, run.id);
  return run;
}

async function onlyEntry(runId: number) {
  const rows = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, runId));
  assert.equal(rows.length, 1, `Expected one payroll entry for run #${runId}`);
  return rows[0];
}

async function caseBenefitPool90k(expected: Record<string, number>, tolerance: number) {
  const org = await createOrg("Golden Phase 2B Benefit Pool");
  try {
    const employee = await createMonthlyEmployee({
      organizationId: org.id,
      employeeNo: "2B-90K",
      salary: 60000,
    });

    const [priorRun] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Prior benefit evidence",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-15",
      scopeLabel: "All locations",
      status: "Released",
      payDate: "2026-06-15",
      employeeCount: 1,
      grossPay: "85000.00",
      netPay: "85000.00",
    }).returning();

    await db.insert(payrollEntries).values({
      payrollRunId: priorRun.id,
      employeeId: employee.id,
      grossPay: "85000.00",
      deductions: "0.00",
      netPay: "85000.00",
      status: "Ready",
      lineItems: [{
        code: "BONUS-PRIOR",
        label: "Prior bonus",
        amount: "85000.00",
        notes: ["Type: bonus"],
        benefitPool90k: true,
        benefitPoolKind: "bonus",
      }],
      trace: {},
    });

    await db.insert(supplementaryEarnings).values({
      organizationId: org.id,
      employeeId: employee.id,
      earningType: "bonus",
      label: "Current bonus",
      amount: "7000.00",
      taxable: false,
      includeInSssBase: false,
      includeInPagIbigBase: false,
      effectiveDate: "2026-12-10",
      status: "approved",
      createdBy: "Golden certification",
    });

    const run = await runPayroll({
      organizationId: org.id,
      label: "Benefit pool crossing",
      periodStart: "2026-12-01",
      periodEnd: "2026-12-15",
      payDate: "2026-12-15",
    });
    const entry = await onlyEntry(run.id);

    const actual = {
      priorPool: traceNumber(entry.trace, "priorBenefitPool90k"),
      currentPool: traceNumber(entry.trace, "currentBenefitPool90k"),
      remainingExemption: traceNumber(entry.trace, "benefitPoolRemainingBeforeCutoff"),
      exemptCurrent: traceNumber(entry.trace, "benefitPoolExemptCurrent"),
      taxableCurrent: traceNumber(entry.trace, "benefitPoolTaxableCurrent"),
      poolAfterCutoff:
        traceNumber(entry.trace, "priorBenefitPool90k")
        + traceNumber(entry.trace, "currentBenefitPool90k"),
      grossPay: Number(entry.grossPay),
      sss: Math.abs(lineAmount(entry, "SSS")),
      philHealth: Math.abs(lineAmount(entry, "PHIC")),
      pagIbig: Math.abs(lineAmount(entry, "HDMF")),
      taxableCompensation: traceNumber(entry.trace, "taxableCompensation"),
      withholdingTax: Math.abs(lineAmount(entry, "WHT")),
      deductions: Number(entry.deductions),
      netPay: Number(entry.netPay),
    };
    for (const [key, value] of Object.entries(expected)) {
      assertMoney(Number(actual[key as keyof typeof actual]), value, `90k pool ${key}`, tolerance);
    }
    return actual;
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
}

async function caseMidCutoffHire(expected: Record<string, number>, tolerance: number) {
  const org = await createOrg("Golden Phase 2B Mid-cutoff Hire");
  try {
    await createMonthlyEmployee({
      organizationId: org.id,
      employeeNo: "2B-HIRE",
      salary: 44000,
      startDate: "2026-09-08",
    });
    const run = await runPayroll({
      organizationId: org.id,
      label: "Mid-cutoff hire",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-15",
      payDate: "2026-09-15",
    });
    const entry = await onlyEntry(run.id);
    const actual = {
      grossPay: Number(entry.grossPay),
      sss: Math.abs(lineAmount(entry, "SSS")),
      philHealth: Math.abs(lineAmount(entry, "PHIC")),
      pagIbig: Math.abs(lineAmount(entry, "HDMF")),
      taxableCompensation: traceNumber(entry.trace, "taxableCompensation"),
      withholdingTax: Math.abs(lineAmount(entry, "WHT")),
      deductions: Number(entry.deductions),
      netPay: Number(entry.netPay),
    };
    for (const [key, value] of Object.entries(expected)) {
      assertMoney(Number(actual[key as keyof typeof actual]), value, `mid-cutoff hire ${key}`, tolerance);
    }
    return actual;
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
}

async function caseRetroPay(expected: Record<string, number>, tolerance: number) {
  const org = await createOrg("Golden Phase 2B Retro");
  try {
    const employee = await createMonthlyEmployee({
      organizationId: org.id,
      employeeNo: "2B-RETRO",
      salary: 40000,
    });
    const [sourceRun] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Aug 16–31 source",
      periodStart: "2026-08-16",
      periodEnd: "2026-08-31",
      scopeLabel: "All locations",
      status: "Released",
      payDate: "2026-08-31",
    }).returning();

    const [revision] = await db.insert(employeePayRevisions).values({
      employeeId: employee.id,
      organizationId: org.id,
      effectiveDate: "2026-09-01",
      previousPayBasis: "monthly",
      previousRateAmount: "35000.00",
      previousStandardWorkDaysPerMonth: "22.00",
      previousStandardHoursPerDay: "8.00",
      newPayBasis: "monthly",
      newRateAmount: "40000.00",
      newStandardWorkDaysPerMonth: "22.00",
      newStandardHoursPerDay: "8.00",
      reason: "Golden retro correction",
      createdBy: "Golden certification",
    }).returning();

    await db.insert(employeePayRetroAdjustments).values({
      organizationId: org.id,
      employeeId: employee.id,
      revisionId: revision.id,
      sourcePayrollRunId: sourceRun.id,
      sourcePeriodLabel: sourceRun.periodLabel,
      amount: "3000.00",
      status: "pending",
    });

    const run = await runPayroll({
      organizationId: org.id,
      label: "Retro current payroll",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-15",
      payDate: "2026-10-15",
    });
    const entry = await onlyEntry(run.id);
    const retro = entryLines(entry).find((item) => String(item.code ?? "").startsWith("RETRO-"));
    const actual = {
      basicPay: lineAmount(entry, "BASIC"),
      retroPay: Number(retro?.amount ?? 0),
      grossPay: Number(entry.grossPay),
      sss: Math.abs(lineAmount(entry, "SSS")),
      philHealth: Math.abs(lineAmount(entry, "PHIC")),
      pagIbig: Math.abs(lineAmount(entry, "HDMF")),
      taxableCompensation: traceNumber(entry.trace, "taxableCompensation"),
      withholdingTax: Math.abs(lineAmount(entry, "WHT")),
      deductions: Number(entry.deductions),
      netPay: Number(entry.netPay),
    };
    for (const [key, value] of Object.entries(expected)) {
      assertMoney(Number(actual[key as keyof typeof actual]), value, `retro ${key}`, tolerance);
    }
    return actual;
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
}

async function caseLeave(expected: Record<string, any>, tolerance: number) {
  const org = await createOrg("Golden Phase 2B Leave");
  try {
    const [paid, unpaid, partial] = await Promise.all([
      createMonthlyEmployee({ organizationId: org.id, employeeNo: "2B-LEAVE-PAID", salary: 22000 }),
      createMonthlyEmployee({ organizationId: org.id, employeeNo: "2B-LEAVE-UNPAID", salary: 22000 }),
      createMonthlyEmployee({ organizationId: org.id, employeeNo: "2B-LEAVE-PARTIAL", salary: 22000 }),
    ]);

    await db.insert(leavePolicies).values([
      { organizationId: org.id, leaveType: "Annual leave", annualDays: "15.0", payTreatment: "paid", paidPercentage: "100.00" },
      { organizationId: org.id, leaveType: "Unpaid leave", annualDays: "365.0", payTreatment: "unpaid", paidPercentage: "0.00" },
      { organizationId: org.id, leaveType: "Study leave", annualDays: "10.0", payTreatment: "partial", paidPercentage: "50.00" },
    ]);
    const [paidLeave, unpaidLeave, partialLeave] = await db.insert(leaveRequests).values([
      { organizationId: org.id, employeeId: paid.id, leaveType: "Annual leave", startDate: "2026-09-14", endDate: "2026-09-18", days: "5.0", reason: "Certification", status: "Approved" },
      { organizationId: org.id, employeeId: unpaid.id, leaveType: "Unpaid leave", startDate: "2026-09-21", endDate: "2026-09-21", days: "1.0", reason: "Certification", status: "Approved" },
      { organizationId: org.id, employeeId: partial.id, leaveType: "Study leave", startDate: "2026-09-22", endDate: "2026-09-22", days: "1.0", reason: "Certification", status: "Approved" },
    ]).returning();

    const run = await runPayroll({
      organizationId: org.id,
      label: "Leave treatment",
      periodStart: "2026-09-16",
      periodEnd: "2026-09-30",
      payDate: "2026-09-30",
    });
    const entries = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
    const byId = new Map(entries.map((entry) => [entry.employeeId, entry]));
    const paidEntry = byId.get(paid.id)!;
    const unpaidEntry = byId.get(unpaid.id)!;
    const partialEntry = byId.get(partial.id)!;

    const actual = {
      paid: {
        grossPay: Number(paidEntry.grossPay),
        leaveAdjustment: entryLines(paidEntry).some((line) => line.code === `LEAVE-${paidLeave.id}`) ? lineAmount(paidEntry, `LEAVE-${paidLeave.id}`) : 0,
      },
      unpaid: {
        grossPay: Number(unpaidEntry.grossPay),
        leaveAdjustment: lineAmount(unpaidEntry, `LEAVE-${unpaidLeave.id}`),
      },
      partial: {
        grossPay: Number(partialEntry.grossPay),
        leaveAdjustment: lineAmount(partialEntry, `LEAVE-${partialLeave.id}`),
      },
    };
    for (const kind of ["paid", "unpaid", "partial"] as const) {
      assertMoney(actual[kind].grossPay, expected[kind].grossPay, `leave ${kind} gross`, tolerance);
      assertMoney(actual[kind].leaveAdjustment, expected[kind].leaveAdjustment, `leave ${kind} adjustment`, tolerance);
    }
    return actual;
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
}

async function caseLoanWaterfall(expected: Record<string, any>, tolerance: number) {
  const org = await createOrg("Golden Phase 2B Loan Waterfall");
  try {
    const employee = await createMonthlyEmployee({
      organizationId: org.id,
      employeeNo: "2B-LOAN",
      salary: 20000,
    });
    await db.insert(employeeLoans).values([
      {
        organizationId: org.id,
        employeeId: employee.id,
        loanType: "SSS Salary Loan",
        referenceNo: "2B-GOV",
        principal: "12000.00",
        monthlyAmortization: "12000.00",
        cutoffDeduction: "6000.00",
        remainingBalance: "12000.00",
        status: "active",
        startDate: "2026-01-01",
      },
      {
        organizationId: org.id,
        employeeId: employee.id,
        loanType: "Company Emergency Loan",
        referenceNo: "2B-COMPANY",
        principal: "10000.00",
        monthlyAmortization: "10000.00",
        cutoffDeduction: "5000.00",
        remainingBalance: "10000.00",
        status: "active",
        startDate: "2026-01-01",
      },
    ]);

    const run = await runPayroll({
      organizationId: org.id,
      label: "Loan waterfall",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-15",
      payDate: "2026-10-15",
    });
    const entry = await onlyEntry(run.id);
    const gov = lineByLabel(entry, "Loan, SSS Salary Loan");
    const company = lineByLabel(entry, "Loan, Company Emergency Loan");
    const coreDeductions =
      Math.abs(lineAmount(entry, "SSS"))
      + Math.abs(lineAmount(entry, "PHIC"))
      + Math.abs(lineAmount(entry, "HDMF"))
      + Math.abs(lineAmount(entry, "WHT"));
    const actual = {
      grossPay: Number(entry.grossPay),
      coreDeductions: round2(coreDeductions),
      governmentLoanDeduction: Math.abs(Number(gov?.amount ?? 0)),
      companyLoanDeduction: Math.abs(Number(company?.amount ?? 0)),
      deductions: Number(entry.deductions),
      netPay: Number(entry.netPay),
      status: entry.status,
    };
    for (const key of ["grossPay","coreDeductions","governmentLoanDeduction","companyLoanDeduction","deductions","netPay"]) {
      assertMoney(Number(actual[key as keyof typeof actual]), Number(expected[key]), `loan ${key}`, tolerance);
    }
    assert.equal(actual.status, expected.status);
    return actual;
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
}

async function caseMonthFinalTrueUp(expected: Record<string, any>, tolerance: number) {
  const org = await createOrg("Golden Phase 2B Month Final");
  try {
    const employee = await createMonthlyEmployee({
      organizationId: org.id,
      employeeNo: "2B-TRUEUP",
      salary: 30000,
    });

    const firstRun = await runPayroll({
      organizationId: org.id,
      label: "September first cutoff",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-15",
      payDate: "2026-09-15",
    });
    const firstEntry = await onlyEntry(firstRun.id);
    await db.update(payrollRuns).set({ status: "Released" }).where(eq(payrollRuns.id, firstRun.id));

    await db.insert(supplementaryEarnings).values({
      organizationId: org.id,
      employeeId: employee.id,
      earningType: "commission",
      label: "September commission",
      amount: "10000.00",
      taxable: true,
      includeInSssBase: true,
      includeInPagIbigBase: true,
      effectiveDate: "2026-09-20",
      status: "approved",
      createdBy: "Golden certification",
    });

    const secondRun = await runPayroll({
      organizationId: org.id,
      label: "September final cutoff",
      periodStart: "2026-09-16",
      periodEnd: "2026-09-30",
      payDate: "2026-09-30",
    });
    const entry = await onlyEntry(secondRun.id);
    const actual = {
      priorGross: Number(firstEntry.grossPay),
      currentGross: Number(entry.grossPay),
      statutoryMonthlySssCompensation: traceNumber(entry.trace, "statutoryMonthlySssCompensation"),
      priorSssEmployee: traceNumber(entry.trace, "priorSssEmployee"),
      sss: Math.abs(lineAmount(entry, "SSS")),
      priorPhilHealthEmployee: traceNumber(entry.trace, "priorPhilHealthEmployee"),
      philHealth: Math.abs(lineAmount(entry, "PHIC")),
      priorPagIbigEmployee: traceNumber(entry.trace, "priorPagIbigEmployee"),
      pagIbig: Math.abs(lineAmount(entry, "HDMF")),
      taxableCompensation: traceNumber(entry.trace, "taxableCompensation"),
      withholdingTax: Math.abs(lineAmount(entry, "WHT")),
      deductions: Number(entry.deductions),
      netPay: Number(entry.netPay),
      reconciliationMode: traceValue(entry.trace, "statutoryReconciliation"),
    };
    for (const [key, value] of Object.entries(expected)) {
      if (key === "reconciliationMode") continue;
      assertMoney(Number(actual[key as keyof typeof actual]), Number(value), `month-final ${key}`, tolerance);
    }
    assert.equal(actual.reconciliationMode, expected.reconciliationMode);
    return actual;
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
}

async function caseHolidayRestOtNsd(expected: Record<string, number>, tolerance: number) {
  const org = await createOrg("Golden Phase 2B Holiday");
  try {
    const employee = await createMonthlyEmployee({
      organizationId: org.id,
      employeeNo: "2B-HOLIDAY",
      salary: 35200,
      restDay: "Tuesday",
    });
    await db.insert(overtimeRequests).values({
      organizationId: org.id,
      employeeId: employee.id,
      workDate: "2026-02-17",
      requestedMinutes: 120,
      reason: "Certification overtime",
      requestKind: "pre_approved",
      status: "approved",
      requestedBy: "Employee",
      decidedBy: "Manager",
      decidedAt: new Date("2026-02-16T08:00:00+08:00"),
      decisionNote: "Approved for certification",
    });
    await db.insert(timePunches).values({
      organizationId: org.id,
      employeeId: employee.id,
      workDate: "2026-02-17",
      timeIn: new Date("2026-02-17T14:00:00+08:00"),
      timeOut: new Date("2026-02-18T01:00:00+08:00"),
      shiftStart: "14:00",
      shiftEnd: "23:00",
      status: "Complete",
    });

    const run = await runPayroll({
      organizationId: org.id,
      label: "Special rest OT NSD",
      periodStart: "2026-02-17",
      periodEnd: "2026-02-17",
      payDate: "2026-02-17",
    });
    const entry = await onlyEntry(run.id);
    const actual = {
      basicPay: lineAmount(entry, "BASIC"),
      holidayPremium: lineAmount(entry, "HOLIDAY"),
      overtimePay: lineAmount(entry, "OT"),
      nightDifferential: lineAmount(entry, "ND"),
      grossPay: Number(entry.grossPay),
      overtimeAuthorizationReviewDays: traceNumber(entry.trace, "overtimeAuthorizationReviewDays"),
    };
    for (const [key, value] of Object.entries(expected)) {
      assertMoney(Number(actual[key as keyof typeof actual]), value, `holiday ${key}`, tolerance);
    }
    return actual;
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
}

function caseFinalPay(expected: Record<string, any>, tolerance: number) {
  const actual = computeFinalPay({
    releasedBasicYtd: 120000,
    historicalBasicYtd: 0,
    unpaidBasicSalary: 10000,
    thirteenthPaidYtd: 5000,
    grossCompensationYtd: 150000,
    statutoryContributionsYtd: 10000,
    taxWithheldYtd: 2000,
    mwe: false,
    leaveMonetizationPay: 5000,
    taxableLeaveMonetizationPay: 5000,
    separationPay: 0,
    retirementPay: 0,
    otherBenefits: 0,
    finalStatutoryDeductions: 500,
    loanDeductions: 3000,
  });
  for (const [key, value] of Object.entries(expected)) {
    if (typeof value === "number") {
      assertMoney(Number((actual as any)[key]), value, `final pay ${key}`, tolerance);
    } else {
      assert.equal((actual as any)[key], value, `final pay ${key}`);
    }
  }
  return {
    basicSalaryEarnedYtd: actual.basicSalaryEarnedYtd,
    thirteenthEntitlement: actual.thirteenthEntitlement,
    thirteenthPaidYtd: actual.thirteenthPaidYtd,
    thirteenthDue: actual.thirteenthDue,
    grossFinalPay: actual.grossFinalPay,
    taxAdjustment: actual.taxAdjustment,
    taxOutcome: actual.taxOutcome,
    taxDue: actual.taxDue,
    taxWithheldYtd: actual.taxWithheldYtd,
    finalStatutoryDeductions: actual.finalStatutoryDeductions,
    requestedLoanDeductions: actual.requestedLoanDeductions,
    loanDeductions: actual.loanDeductions,
    deferredLoanBalance: actual.deferredLoanBalance,
    netFinalPay: actual.netFinalPay,
  };
}

async function main() {
  mkdirSync("qa-artifacts", { recursive: true });
  const rawCatalog = readFileSync(catalogPath);
  const catalog = JSON.parse(rawCatalog.toString("utf8")) as ExpectedCatalog;
  const tolerance = catalog.tolerancePeso;

  const results: Record<string, unknown> = {};
  results.benefitPool90k = await caseBenefitPool90k(catalog.cases.benefitPool90k.expected, tolerance);
  results.midCutoffHire = await caseMidCutoffHire(catalog.cases.midCutoffHire.expected, tolerance);
  results.retroPay = await caseRetroPay(catalog.cases.retroPay.expected, tolerance);
  results.leave = await caseLeave(catalog.cases.leave.expected, tolerance);
  results.loanWaterfall = await caseLoanWaterfall(catalog.cases.loanWaterfall.expected, tolerance);
  results.monthFinalTrueUp = await caseMonthFinalTrueUp(catalog.cases.monthFinalTrueUp.expected, tolerance);
  results.holidayRestOtNsd = await caseHolidayRestOtNsd(catalog.cases.holidayRestOtNsd.expected, tolerance);
  results.finalPay = caseFinalPay(catalog.cases.finalPay.expected, tolerance);

  const report = {
    generatedAt: new Date().toISOString(),
    status: "passed",
    phase: "2B",
    catalogVersion: catalog.version,
    catalogSha256: createHash("sha256").update(rawCatalog).digest("hex"),
    tolerancePeso: tolerance,
    caseCount: Object.keys(results).length,
    cases: results,
    limitations: catalog.limitations,
  };
  writeFileSync(artifactPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    status: report.status,
    caseCount: report.caseCount,
    catalogSha256: report.catalogSha256,
  }, null, 2));
}

main()
  .catch((error) => {
    mkdirSync("qa-artifacts", { recursive: true });
    writeFileSync(
      artifactPath,
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        status: "failed",
        error: error instanceof Error ? error.stack ?? error.message : String(error),
      }, null, 2),
    );
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
