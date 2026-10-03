import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees, historicalPayrollEntries, payrollEntries, payrollRuns, yearEndAdjustments } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { ensureMigrationSchema } from "@/lib/migration-schema";
import { annualize, ANNUALIZATION_RULE_VERSION, type AnnualizationResult } from "@/lib/annualization";
import { readBasicAndThirteenth } from "@/lib/final-pay";

type LineItem = {
  code?: string;
  label?: string;
  amount?: number | string;
  periodOtherBenefitsPool?: number;
};

function sumContributionsAndTax(lineItems: unknown) {
  const items = Array.isArray(lineItems) ? (lineItems as LineItem[]) : [];
  let contributions = 0;
  let tax = 0;
  let thirteenth = 0;
  let reimbursements = 0;
  let deMinimisExempt = 0;
  let otherBenefitsPool = 0;
  let mweExemptCompensation = 0;

  for (const item of items) {
    const signedAmount = Number(item.amount ?? 0);
    const amount = Math.abs(signedAmount);
    if (!Number.isFinite(amount)) continue;
    const code = String(item.code ?? "").toUpperCase();
    const label = `${item.code ?? ""} ${item.label ?? ""}`.toLowerCase();

    if (label.includes("sss") || label.includes("philhealth") || label.includes("pag-ibig") || label.includes("pagibig")) {
      contributions += amount;
    } else if (label.includes("withholding") || label.includes("tax")) {
      tax += amount;
    } else if (label.includes("13th") || label.includes("thirteenth")) {
      thirteenth += Math.max(0, signedAmount);
    }

    if (code.startsWith("EXP-")) {
      reimbursements += Math.max(0, signedAmount);
    }

    if (code.startsWith("DM-")) {
      const poolAmount = Math.max(0, Number(item.periodOtherBenefitsPool ?? 0));
      otherBenefitsPool += poolAmount;
      deMinimisExempt += Math.max(0, signedAmount - poolAmount);
    }

    if (
      code === "BASIC"
      || code === "OT"
      || code === "ND"
      || code === "HOLIDAY"
      || code === "HOLIDAY_UNWORKED"
      || code === "CALAMITY"
      || code.startsWith("RETRO-")
      || (code.startsWith("LEAVE-") && !code.startsWith("LEAVE_CONV-"))
      || code === "LATE"
      || code === "UT"
    ) {
      mweExemptCompensation += signedAmount;
    }
  }

  return {
    contributions,
    tax,
    thirteenth,
    reimbursements,
    deMinimisExempt,
    otherBenefitsPool,
    mweExemptCompensation: Math.max(0, mweExemptCompensation),
  };
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

  const totals = new Map<number, {
    gross: number;
    basic: number;
    contributions: number;
    tax: number;
    thirteenthPaid: number;
    deMinimisExempt: number;
    otherBenefitsPool: number;
    mweExemptCompensation: number;
    periods: number;
    importedPeriods: number;
  }>();
  for (const entry of entries) {
    const bucket = totals.get(entry.employeeId) ?? { gross: 0, basic: 0, contributions: 0, tax: 0, thirteenthPaid: 0, deMinimisExempt: 0, otherBenefitsPool: 0, mweExemptCompensation: 0, periods: 0, importedPeriods: 0 };
    const parsed = sumContributionsAndTax(entry.lineItems);
    const basic = readBasicAndThirteenth(entry.lineItems);
    bucket.gross += Math.max(0, Number(entry.grossPay) - parsed.reimbursements);
    bucket.basic += basic.basic;
    bucket.contributions += parsed.contributions;
    bucket.tax += parsed.tax;
    bucket.thirteenthPaid += parsed.thirteenth;
    bucket.deMinimisExempt += parsed.deMinimisExempt;
    bucket.otherBenefitsPool += parsed.otherBenefitsPool;
    bucket.mweExemptCompensation += parsed.mweExemptCompensation;
    bucket.periods += 1;
    totals.set(entry.employeeId, bucket);
  }

  for (const entry of importedHistory) {
    const bucket = totals.get(entry.employeeId) ?? { gross: 0, basic: 0, contributions: 0, tax: 0, thirteenthPaid: 0, deMinimisExempt: 0, otherBenefitsPool: 0, mweExemptCompensation: 0, periods: 0, importedPeriods: 0 };
    if (entry.basicSalary == null) {
      throw new Error(
        `Imported payroll history row #${entry.id} is missing basic salary earned. Re-import payroll history with Basic Salary Earned before running year-end annualization.`,
      );
    }
    bucket.gross += Number(entry.grossPay);
    bucket.basic += Number(entry.basicSalary);
    bucket.contributions += Number(entry.sssEmployee) + Number(entry.philHealthEmployee) + Number(entry.pagIbigEmployee);
    bucket.tax += Number(entry.taxWithheld);
    bucket.thirteenthPaid += Number(entry.thirteenthMonth);
    bucket.periods += 1;
    bucket.importedPeriods += 1;
    totals.set(entry.employeeId, bucket);
  }

  await db.delete(yearEndAdjustments).where(and(
    eq(yearEndAdjustments.organizationId, organizationId),
    eq(yearEndAdjustments.taxYear, taxYear),
  ));

  const rows: Array<{
    employee: typeof staff[number];
    result: AnnualizationResult;
    periods: number;
    importedPeriods: number;
    basicSalaryEarned: number;
    thirteenthEntitlement: number;
    thirteenthAlreadyPaid: number;
  }> = [];

  for (const employee of staff) {
    const bucket = totals.get(employee.id);
    if (!bucket || bucket.periods === 0) continue;

    // DOLE minimum 13th month: total basic salary actually earned in the
    // calendar year divided by 12. Do not infer from the employee's current
    // salary or payroll-period count because rate changes and unpaid time make
    // that inaccurate.
    const thirteenthEntitlement = Math.round(((bucket.basic / 12) + Number.EPSILON) * 100) / 100;
    const annualThirteenth = Math.max(thirteenthEntitlement, bucket.thirteenthPaid);

    const unpaidThirteenthAccrual = Math.max(0, annualThirteenth - bucket.thirteenthPaid);
    const result = annualize({
      grossCompensation: bucket.gross + unpaidThirteenthAccrual,
      thirteenthMonth: annualThirteenth,
      otherBenefits: bucket.otherBenefitsPool,
      deMinimis: bucket.deMinimisExempt,
      statutoryContributions: bucket.contributions,
      taxWithheld: bucket.tax,
      mwe: employee.mwe,
      mweExemptCompensation: employee.mwe ? bucket.mweExemptCompensation : 0,
    });

    rows.push({
      employee,
      result,
      periods: bucket.periods,
      importedPeriods: bucket.importedPeriods,
      basicSalaryEarned: bucket.basic,
      thirteenthEntitlement,
      thirteenthAlreadyPaid: bucket.thirteenthPaid,
    });
  }

  if (rows.length) {
    await db.insert(yearEndAdjustments).values(rows.map(({
      employee,
      result,
      periods,
      importedPeriods,
      basicSalaryEarned,
      thirteenthEntitlement,
      thirteenthAlreadyPaid,
    }) => ({
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
        importedHistoryRows: importedPeriods,
        basicSalaryEarned,
        thirteenthEntitlement,
        thirteenthAlreadyPaid,
        thirteenthStillDue: Math.max(0, thirteenthEntitlement - thirteenthAlreadyPaid),
        deMinimisExempt: bucket.deMinimisExempt,
        otherBenefitsPool: bucket.otherBenefitsPool,
        mweExemptCompensation: employee.mwe ? bucket.mweExemptCompensation : 0,
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
