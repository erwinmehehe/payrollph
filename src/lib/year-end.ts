import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  employeePayRetroAdjustments,
  employees,
  historicalPayrollEntries,
  payrollEntries,
  payrollRuns,
  yearEndAdjustments,
} from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { ensureMigrationSchema } from "@/lib/migration-schema";
import { annualize, ANNUALIZATION_RULE_VERSION, type AnnualizationResult } from "@/lib/annualization";
import {
  computeThirteenthMonthBalance,
  payrollTaxSummary,
  thirteenthMonthBasicFromEntry,
} from "@/lib/final-pay";

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

  const retroRows = await db.select().from(employeePayRetroAdjustments)
    .where(eq(employeePayRetroAdjustments.organizationId, organizationId));
  const sourceRunIds = [...new Set(retroRows.map((row) => row.sourcePayrollRunId))];
  const sourceRuns = sourceRunIds.length
    ? await db.select().from(payrollRuns).where(inArray(payrollRuns.id, sourceRunIds))
    : [];
  const sourceRunById = new Map(sourceRuns.map((run) => [run.id, run]));
  const eligibleRetroIds = new Set(
    retroRows
      .filter((row) => {
        const sourceRun = sourceRunById.get(row.sourcePayrollRunId);
        return sourceRun && new Date(`${sourceRun.periodEnd}T00:00:00Z`).getUTCFullYear() === taxYear;
      })
      .map((row) => row.id),
  );

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

  const emptyBucket = () => ({
    gross: 0,
    contributions: 0,
    tax: 0,
    thirteenthPaid: 0,
    thirteenthBasic: 0,
    otherNonTaxable: 0,
    periods: 0,
    importedPeriods: 0,
    incompleteImportedBasic: 0,
  });
  const totals = new Map<number, ReturnType<typeof emptyBucket>>();

  for (const entry of entries) {
    const bucket = totals.get(entry.employeeId) ?? emptyBucket();
    const tax = payrollTaxSummary(entry);
    bucket.gross += tax.grossCompensation;
    bucket.contributions += tax.statutoryContributions;
    bucket.tax += tax.taxWithheld;
    bucket.thirteenthPaid += tax.thirteenthMonth;
    bucket.thirteenthBasic += thirteenthMonthBasicFromEntry(entry, { eligibleRetroIds });
    bucket.otherNonTaxable += tax.otherNonTaxable;
    bucket.periods += 1;
    totals.set(entry.employeeId, bucket);
  }

  for (const entry of importedHistory) {
    const bucket = totals.get(entry.employeeId) ?? emptyBucket();
    bucket.gross += Number(entry.grossPay);
    bucket.contributions += Number(entry.sssEmployee) + Number(entry.philHealthEmployee) + Number(entry.pagIbigEmployee);
    bucket.tax += Number(entry.taxWithheld);
    bucket.thirteenthPaid += Number(entry.thirteenthMonth);
    bucket.thirteenthBasic += Number(entry.basicSalaryEarned);
    bucket.otherNonTaxable += Number(entry.otherNonTaxable);
    if (Number(entry.grossPay) > 0 && Number(entry.basicSalaryEarned) <= 0 && Number(entry.thirteenthMonth) <= 0) {
      bucket.incompleteImportedBasic += 1;
    }
    bucket.periods += 1;
    bucket.importedPeriods += 1;
    totals.set(entry.employeeId, bucket);
  }

  await db.delete(yearEndAdjustments).where(and(
    eq(yearEndAdjustments.organizationId, organizationId),
    eq(yearEndAdjustments.taxYear, taxYear),
  ));

  const rows: Array<{ employee: typeof staff[number]; result: AnnualizationResult; periods: number; thirteenthBalance: number }> = [];
  const incompleteImported = staff.flatMap((employee) => {
    const bucket = totals.get(employee.id);
    return bucket && bucket.incompleteImportedBasic > 0
      ? [{ employeeNo: employee.employeeNo, rows: bucket.incompleteImportedBasic }]
      : [];
  });
  if (incompleteImported.length > 0) {
    throw new Error(
      `Imported payroll history is missing Basic Salary Earned for 13th-month computation: ${incompleteImported.map((row) => `${row.employeeNo} (${row.rows} row(s))`).join(", ")}. Re-import those payroll rows with the 13th-month salary basis before annualization.`,
    );
  }

  for (const employee of staff) {
    const bucket = totals.get(employee.id);
    if (!bucket || bucket.periods === 0) continue;

    const thirteenth = computeThirteenthMonthBalance({
      basicSalaryEarned: bucket.thirteenthBasic,
      alreadyPaid: bucket.thirteenthPaid,
      eligible: employee.thirteenthMonthEligible,
    });
    const totalThirteenthForYear = Math.max(thirteenth.entitlement, thirteenth.alreadyPaid);
    const projectedGross = bucket.gross + thirteenth.balanceDue;

    const result = annualize({
      grossCompensation: projectedGross,
      thirteenthMonth: totalThirteenthForYear,
      statutoryContributions: bucket.contributions,
      taxWithheld: bucket.tax,
      otherNonTaxable: bucket.otherNonTaxable,
      mwe: employee.mwe,
    });

    rows.push({ employee, result, periods: bucket.periods, thirteenthBalance: thirteenth.balanceDue });
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
        periodsIncluded: periods,
        runsIncluded: runIds.length,
        importedHistoryRows: totals.get(employee.id)?.importedPeriods ?? 0,
        thirteenthMonthBasicEarned: totals.get(employee.id)?.thirteenthBasic ?? 0,
        thirteenthMonthAlreadyPaid: totals.get(employee.id)?.thirteenthPaid ?? 0,
        thirteenthMonthBalanceDue: thirteenthBalance,
        thirteenthMonthEligible: employee.thirteenthMonthEligible,
        thirteenthMonthExclusionReason: employee.thirteenthMonthExclusionReason,
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
    },
  });

  return {
    taxYear,
    runsIncluded: runIds.length,
    importedHistoryRows: importedHistory.length,
    employees: rows.length,
    refunds: refunds.length,
    collections: collections.length,
    totalRefund: Number(refunds.reduce((sum, row) => sum + Math.abs(row.result.adjustment), 0).toFixed(2)),
    totalCollect: Number(collections.reduce((sum, row) => sum + row.result.adjustment, 0).toFixed(2)),
    ruleVersion: ANNUALIZATION_RULE_VERSION,
  };
}
