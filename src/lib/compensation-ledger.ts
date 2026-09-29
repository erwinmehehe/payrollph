import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  historicalPayrollEntries,
  payrollEntries,
  payrollRuns,
} from "@/db/schema";
import { ensureEmployeePayHistorySchema } from "@/lib/pay-basis-schema";
import {
  basicSalaryEarnedForYear,
  round2,
  thirteenthMonthPaidFromLineItems,
} from "@/lib/pay-history";
import { computeThirteenthMonthPay } from "@/lib/ph-compliance";

type LineItem = {
  code?: string;
  label?: string;
  amount?: string | number;
};

function yearOf(date: string) {
  return Number(date.slice(0, 4));
}

function sumPayrollComponents(lineItems: unknown) {
  const rows = Array.isArray(lineItems) ? lineItems as LineItem[] : [];
  let statutoryContributions = 0;
  let taxWithheld = 0;
  let deMinimis = 0;

  for (const row of rows) {
    const code = String(row.code ?? "").toUpperCase();
    const amount = Math.abs(Number(row.amount ?? 0));
    if (!Number.isFinite(amount)) continue;
    if (code === "SSS" || code === "PHIC" || code === "HDMF") statutoryContributions += amount;
    else if (code === "WHT") taxWithheld += amount;
    else if (code.startsWith("DM-")) deMinimis += amount;
  }

  return {
    statutoryContributions: round2(statutoryContributions),
    taxWithheld: round2(taxWithheld),
    deMinimis: round2(deMinimis),
  };
}

export type EmployeeYearLedger = {
  taxYear: number;
  employeeId: number;
  grossCompensation: number;
  basicSalaryEarned: number;
  statutoryContributions: number;
  taxWithheld: number;
  deMinimis: number;
  thirteenthMonthAccrued: number;
  thirteenthMonthPreviouslyPaid: number;
  thirteenthMonthOutstanding: number;
  releasedPeriods: number;
  importedPeriods: number;
  importedBasicSalaryMissing: number;
  dataComplete: boolean;
};

export async function buildEmployeeYearLedger(input: {
  organizationId: number;
  employeeId: number;
  taxYear: number;
  throughDate?: string;
}): Promise<EmployeeYearLedger> {
  await ensureEmployeePayHistorySchema();

  const yearStart = `${input.taxYear}-01-01`;
  const yearEnd = input.throughDate && input.throughDate < `${input.taxYear}-12-31`
    ? input.throughDate
    : `${input.taxYear}-12-31`;

  const runs = await db.select().from(payrollRuns).where(and(
    eq(payrollRuns.organizationId, input.organizationId),
    eq(payrollRuns.status, "Released"),
    gte(payrollRuns.periodEnd, yearStart),
    lte(payrollRuns.periodStart, yearEnd),
  ));
  const runIds = runs.map((run) => run.id);
  const runById = new Map(runs.map((run) => [run.id, run]));
  const entries = runIds.length
    ? await db.select().from(payrollEntries).where(and(
        inArray(payrollEntries.payrollRunId, runIds),
        eq(payrollEntries.employeeId, input.employeeId),
      ))
    : [];

  const imported = await db.select().from(historicalPayrollEntries).where(and(
    eq(historicalPayrollEntries.organizationId, input.organizationId),
    eq(historicalPayrollEntries.employeeId, input.employeeId),
    gte(historicalPayrollEntries.payDate, yearStart),
    lte(historicalPayrollEntries.payDate, yearEnd),
  ));

  let grossCompensation = 0;
  let basicSalaryEarned = 0;
  let statutoryContributions = 0;
  let taxWithheld = 0;
  let deMinimis = 0;
  let thirteenthMonthPreviouslyPaid = 0;

  for (const entry of entries) {
    const run = runById.get(entry.payrollRunId);
    if (!run) continue;
    const parts = sumPayrollComponents(entry.lineItems);
    grossCompensation += Number(entry.grossPay);
    statutoryContributions += parts.statutoryContributions;
    taxWithheld += parts.taxWithheld;
    deMinimis += parts.deMinimis;
    basicSalaryEarned += basicSalaryEarnedForYear(
      entry.lineItems,
      yearOf(String(run.periodEnd)),
      input.taxYear,
    );
    if (yearOf(String(run.payDate)) === input.taxYear) {
      thirteenthMonthPreviouslyPaid += thirteenthMonthPaidFromLineItems(entry.lineItems);
    }
  }

  let importedBasicSalaryMissing = 0;
  for (const row of imported) {
    grossCompensation += Number(row.grossPay);
    statutoryContributions += Number(row.sssEmployee) + Number(row.philHealthEmployee) + Number(row.pagIbigEmployee);
    taxWithheld += Number(row.taxWithheld);
    thirteenthMonthPreviouslyPaid += Number(row.thirteenthMonth);
    if (row.basicSalaryEarned == null) {
      if (Number(row.grossPay) > 0) importedBasicSalaryMissing += 1;
    } else {
      basicSalaryEarned += Number(row.basicSalaryEarned);
    }
  }

  const accrued = computeThirteenthMonthPay(basicSalaryEarned);
  const previouslyPaid = round2(thirteenthMonthPreviouslyPaid);

  return {
    taxYear: input.taxYear,
    employeeId: input.employeeId,
    grossCompensation: round2(grossCompensation),
    basicSalaryEarned: round2(basicSalaryEarned),
    statutoryContributions: round2(statutoryContributions),
    taxWithheld: round2(taxWithheld),
    deMinimis: round2(deMinimis),
    thirteenthMonthAccrued: accrued,
    thirteenthMonthPreviouslyPaid: previouslyPaid,
    thirteenthMonthOutstanding: round2(Math.max(0, accrued - previouslyPaid)),
    releasedPeriods: entries.length,
    importedPeriods: imported.length,
    importedBasicSalaryMissing,
    dataComplete: importedBasicSalaryMissing === 0,
  };
}
