import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees, historicalPayrollEntries, payrollEntries, payrollRuns, yearEndAdjustments } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { ensureMigrationSchema } from "@/lib/migration-schema";
import { annualize, ANNUALIZATION_RULE_VERSION, type AnnualizationResult } from "@/lib/annualization";
import { buildEmployeeYearLedger } from "@/lib/compensation-ledger";

type LineItem = { code?: string; label?: string; amount?: number | string };

function sumContributionsAndTax(lineItems: unknown) {
  const items = Array.isArray(lineItems) ? (lineItems as LineItem[]) : [];
  let contributions = 0;
  let tax = 0;
  let thirteenth = 0;

  for (const item of items) {
    const amount = Math.abs(Number(item.amount ?? 0));
    if (!Number.isFinite(amount)) continue;
    const label = `${item.code ?? ""} ${item.label ?? ""}`.toLowerCase();
    if (label.includes("sss") || label.includes("philhealth") || label.includes("pag-ibig") || label.includes("pagibig")) {
      contributions += amount;
    } else if (label.includes("withholding") || label.includes("tax")) {
      tax += amount;
    } else if (label.includes("13th") || label.includes("thirteenth")) {
      thirteenth += amount;
    }
  }

  return { contributions, tax, thirteenth };
}

/**
 * Aggregates every released payroll entry for the tax year and runs the
 * December annualization for each employee. Idempotent: re-running replaces
 * that year's adjustments for the organization.
 */
export async function runYearEndAnnualization(organizationId: number, taxYear: number, actor: string) {
  await ensureMigrationSchema();

  const runs = await db
    .select()
    .from(payrollRuns)
    .where(and(
      eq(payrollRuns.organizationId, organizationId),
      eq(payrollRuns.status, "Released"),
      sql`extract(year from ${payrollRuns.payDate}) = ${taxYear}`,
    ));

  const runIds = runs.map((run) => run.id);
  const staff = await db.select().from(employees).where(eq(employees.organizationId, organizationId));

  const entries = runIds.length
    ? await db.select().from(payrollEntries).where(inArray(payrollEntries.payrollRunId, runIds))
    : [];

  // A company can switch payroll providers mid-year. Imported payroll history is
  // preserved as source-of-truth totals and participates in annualization without
  // being recalculated under the current Linaw rule tables.
  const importedHistory = await db
    .select()
    .from(historicalPayrollEntries)
    .where(and(
      eq(historicalPayrollEntries.organizationId, organizationId),
      sql`extract(year from ${historicalPayrollEntries.payDate}) = ${taxYear}`,
    ));

  const totals = new Map<number, { gross: number; contributions: number; tax: number; thirteenth: number; periods: number; importedPeriods: number }>();
  for (const entry of entries) {
    const bucket = totals.get(entry.employeeId) ?? { gross: 0, contributions: 0, tax: 0, thirteenth: 0, periods: 0, importedPeriods: 0 };
    const parsed = sumContributionsAndTax(entry.lineItems);
    bucket.gross += Number(entry.grossPay);
    bucket.contributions += parsed.contributions;
    bucket.tax += parsed.tax;
    bucket.thirteenth += parsed.thirteenth;
    bucket.periods += 1;
    totals.set(entry.employeeId, bucket);
  }

  for (const entry of importedHistory) {
    const bucket = totals.get(entry.employeeId) ?? { gross: 0, contributions: 0, tax: 0, thirteenth: 0, periods: 0, importedPeriods: 0 };
    bucket.gross += Number(entry.grossPay);
    bucket.contributions += Number(entry.sssEmployee) + Number(entry.philHealthEmployee) + Number(entry.pagIbigEmployee);
    bucket.tax += Number(entry.taxWithheld);
    bucket.thirteenth += Number(entry.thirteenthMonth);
    bucket.periods += 1;
    bucket.importedPeriods += 1;
    totals.set(entry.employeeId, bucket);
  }

  await db.delete(yearEndAdjustments).where(and(
    eq(yearEndAdjustments.organizationId, organizationId),
    eq(yearEndAdjustments.taxYear, taxYear),
  ));

  const rows: Array<{ employee: typeof staff[number]; result: AnnualizationResult; periods: number; ledger: Awaited<ReturnType<typeof buildEmployeeYearLedger>> }> = [];
  const blockedEmployees: Array<{ employeeId: number; employeeNo: string; missingImportedBasicRows: number }> = [];

  for (const employee of staff) {
    const bucket = totals.get(employee.id);
    if (!bucket || bucket.periods === 0) continue;

    const ledger = await buildEmployeeYearLedger({
      organizationId,
      employeeId: employee.id,
      taxYear,
    });
    if (!ledger.dataComplete) {
      blockedEmployees.push({
        employeeId: employee.id,
        employeeNo: employee.employeeNo,
        missingImportedBasicRows: ledger.importedBasicSalaryMissing,
      });
      continue;
    }

    const result = annualize({
      grossCompensation: ledger.grossCompensation,
      thirteenthMonth: ledger.thirteenthMonthAccrued,
      statutoryContributions: ledger.statutoryContributions,
      taxWithheld: ledger.taxWithheld,
      deMinimis: ledger.deMinimis,
      mwe: employee.mwe,
    });

    rows.push({ employee, result, periods: ledger.releasedPeriods + ledger.importedPeriods, ledger });
  }

  if (rows.length) {
    await db.insert(yearEndAdjustments).values(rows.map(({ employee, result, periods }) => ({
      organizationId,
      employeeId: employee.id,
      taxYear,
      grossCompensation: result.grossCompensation.toFixed(2),
      thirteenthMonth: result.thirteenthMonth.toFixed(2),
      nonTaxable: result.nonTaxable.toFixed(2),
      statutoryContributions: result.statutoryContributions.toFixed(2),
      taxableIncome: result.taxableIncome.toFixed(2),
      taxDue: result.taxDue.toFixed(2),
      taxWithheld: result.taxWithheld.toFixed(2),
      adjustment: result.adjustment.toFixed(2),
      outcome: result.outcome,
      mwe: result.mwe,
      breakdown: {
        ...result,
        basicSalaryEarned: ledger.basicSalaryEarned,
        thirteenthMonthAccrued: ledger.thirteenthMonthAccrued,
        thirteenthMonthPreviouslyPaid: ledger.thirteenthMonthPreviouslyPaid,
        thirteenthMonthOutstanding: ledger.thirteenthMonthOutstanding,
        periodsIncluded: periods,
        runsIncluded: runIds.length,
        importedHistoryRows: ledger.importedPeriods,
        sourceDataComplete: ledger.dataComplete,
      },
      ruleVersion: ANNUALIZATION_RULE_VERSION,
    })));
  }

  const refunds = rows.filter((row) => row.result.outcome === "refund");
  const collections = rows.filter((row) => row.result.outcome === "collect");

  await recordAuditEvent({
    organizationId,
    actor,
    action: "Year-end annualization computed",
    resource: `Tax year ${taxYear}`,
    metadata: {
      ruleVersion: ANNUALIZATION_RULE_VERSION,
      employees: rows.length,
      runsIncluded: runIds.length,
      importedHistoryRows: importedHistory.length,
      refunds: refunds.length,
      collections: collections.length,
      blockedEmployees: blockedEmployees.length,
    },
  });

  return {
    taxYear,
    runsIncluded: runIds.length,
    importedHistoryRows: importedHistory.length,
    employees: rows.length,
    blockedEmployees,
    refunds: refunds.length,
    collections: collections.length,
    totalRefund: Number(refunds.reduce((sum, row) => sum + Math.abs(row.result.adjustment), 0).toFixed(2)),
    totalCollect: Number(collections.reduce((sum, row) => sum + row.result.adjustment, 0).toFixed(2)),
    ruleVersion: ANNUALIZATION_RULE_VERSION,
  };
}
