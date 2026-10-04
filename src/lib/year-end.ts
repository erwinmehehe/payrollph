import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees, historicalPayrollEntries, payrollEntries, payrollRuns, payslips, yearEndAdjustments } from "@/db/schema";
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

function traceNumber(trace: unknown, prefix: string) {
  if (!trace || typeof trace !== "object") return 0;
  const inputs = (trace as { inputs?: unknown }).inputs;
  if (!Array.isArray(inputs)) return 0;
  const raw = inputs.find((item) => typeof item === "string" && item.startsWith(prefix));
  if (typeof raw !== "string") return 0;
  const value = Number(raw.slice(prefix.length));
  return Number.isFinite(value) ? value : 0;
}

function sumContributionsAndTax(lineItems: unknown, trace?: unknown) {
  const items = Array.isArray(lineItems) ? (lineItems as LineItem[]) : [];
  let contributions = 0;
  let tax = 0;
  let thirteenth = 0;
  let reimbursements = 0;
  let deMinimisExempt = 0;
  let otherBenefitsPool = 0;
  let mweTaxableSupplementaryCompensation = traceNumber(trace, "mweTaxableSupplementaryCompensation=");

  for (const item of items) {
    const signedAmount = Number(item.amount ?? 0);
    const amount = Math.abs(signedAmount);
    if (!Number.isFinite(amount)) continue;
    const code = String(item.code ?? "").toUpperCase();
    const label = `${item.code ?? ""} ${item.label ?? ""}`.toLowerCase();

    if (
      code !== "HDMF_VOL"
      && (label.includes("sss") || label.includes("philhealth") || label.includes("pag-ibig") || label.includes("pagibig"))
    ) {
      contributions += amount;
    } else if (code.startsWith("YEAR_END_TAX-")) {
      // Negative line = additional tax collected; positive line = refund of
      // tax previously withheld. Re-running annualization after release must
      // therefore net the adjustment into the YTD withholding total, not add
      // its absolute value in both directions.
      tax += -signedAmount;
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

  }

  return {
    contributions,
    tax,
    thirteenth,
    reimbursements,
    deMinimisExempt,
    deMinimisExcess: otherBenefitsPool,
    mweTaxableSupplementaryCompensation: Math.max(0, mweTaxableSupplementaryCompensation),
  };
}

/**
 * Aggregates every released payroll entry for the tax year and runs the
 * December annualization for each employee. Idempotent: re-running replaces
 * that year's adjustments for the organization.
 */
export async function runYearEndAnnualization(
  organizationId: number,
  taxYear: number,
  actor: string,
  options: { includePayrollRunId?: number } = {},
) {
  await ensureMigrationSchema();

  const releasedRuns = await db
    .select()
    .from(payrollRuns)
    .where(and(
      eq(payrollRuns.organizationId, organizationId),
      eq(payrollRuns.status, "Released"),
      sql`extract(year from ${payrollRuns.payDate}) = ${taxYear}`,
    ));

  let runs = releasedRuns;
  if (options.includePayrollRunId) {
    const [candidate] = await db.select().from(payrollRuns).where(and(
      eq(payrollRuns.id, options.includePayrollRunId),
      eq(payrollRuns.organizationId, organizationId),
    )).limit(1);
    if (!candidate) throw new Error("The requested year-end payroll run was not found in this organization.");
    if (String(candidate.payDate).slice(0, 4) !== String(taxYear)) {
      throw new Error("The year-end payroll run must have a pay date inside the tax year being annualized.");
    }
    if (candidate.status !== "Needs review") {
      throw new Error("Apply year-end tax only to a fully calculated payroll run in Needs review status.");
    }
    if (String(candidate.periodEnd) !== `${taxYear}-12-31`) {
      throw new Error("Year-end tax adjustments can be staged only into the final December cutoff ending December 31.");
    }
    if (!runs.some((row) => row.id === candidate.id)) runs = [...runs, candidate];
  }

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
    mweTaxableSupplementaryCompensation: number;
    periods: number;
    importedPeriods: number;
  }>();
  for (const entry of entries) {
    const bucket = totals.get(entry.employeeId) ?? { gross: 0, basic: 0, contributions: 0, tax: 0, thirteenthPaid: 0, deMinimisExempt: 0, otherBenefitsPool: 0, mweTaxableSupplementaryCompensation: 0, periods: 0, importedPeriods: 0 };
    const parsed = sumContributionsAndTax(entry.lineItems, entry.trace);
    const basic = readBasicAndThirteenth(entry.lineItems);
    bucket.gross += Math.max(0, Number(entry.grossPay) - parsed.reimbursements);
    bucket.basic += basic.basic;
    bucket.contributions += parsed.contributions;
    bucket.tax += parsed.tax;
    bucket.thirteenthPaid += parsed.thirteenth;
    bucket.deMinimisExempt += parsed.deMinimisExempt;
    bucket.otherBenefitsPool += parsed.deMinimisExcess;
    bucket.mweTaxableSupplementaryCompensation += parsed.mweTaxableSupplementaryCompensation;
    bucket.periods += 1;
    totals.set(entry.employeeId, bucket);
  }

  for (const entry of importedHistory) {
    const bucket = totals.get(entry.employeeId) ?? { gross: 0, basic: 0, contributions: 0, tax: 0, thirteenthPaid: 0, deMinimisExempt: 0, otherBenefitsPool: 0, mweTaxableSupplementaryCompensation: 0, periods: 0, importedPeriods: 0 };
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

  const existingAdjustments = await db.select().from(yearEndAdjustments).where(and(
    eq(yearEndAdjustments.organizationId, organizationId),
    eq(yearEndAdjustments.taxYear, taxYear),
  ));
  const settledAdjustments = existingAdjustments.filter((row) => row.appliedPayrollRunId != null || row.appliedAt != null);
  if (settledAdjustments.length > 0) {
    throw new Error(
      `Year-end tax for ${taxYear} has already been settled into payroll. Reverse it with a separately audited payroll adjustment instead of recomputing history.`,
    );
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
    deMinimisExempt: number;
    otherBenefitsPool: number;
    mweTaxableSupplementaryCompensation: number;
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

    if (employee.mwe && bucket.importedPeriods > 0) {
      throw new Error(
        `Imported payroll history for MWE employee ${employee.employeeNo} does not contain the statutory-wage versus taxable-supplementary breakdown required for safe annualization. Import the detailed breakdown or annualize this employee outside Linaw and record the verified adjustment.`,
      );
    }

    const unpaidThirteenthAccrual = Math.max(0, annualThirteenth - bucket.thirteenthPaid);
    const result = annualize({
      grossCompensation: bucket.gross + unpaidThirteenthAccrual,
      thirteenthMonth: annualThirteenth,
      otherBenefits: 0,
      deMinimis: bucket.deMinimisExempt,
      deMinimisExcess: bucket.otherBenefitsPool,
      statutoryContributions: bucket.contributions,
      taxWithheld: bucket.tax,
      mwe: employee.mwe,
      mweTaxableSupplementaryCompensation: employee.mwe
        ? bucket.mweTaxableSupplementaryCompensation
        : 0,
    });

    rows.push({
      employee,
      result,
      periods: bucket.periods,
      importedPeriods: bucket.importedPeriods,
      basicSalaryEarned: bucket.basic,
      thirteenthEntitlement,
      thirteenthAlreadyPaid: bucket.thirteenthPaid,
      deMinimisExempt: bucket.deMinimisExempt,
      otherBenefitsPool: bucket.otherBenefitsPool,
      mweTaxableSupplementaryCompensation: employee.mwe
        ? bucket.mweTaxableSupplementaryCompensation
        : 0,
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
      deMinimisExempt,
      otherBenefitsPool,
      mweTaxableSupplementaryCompensation,
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
        deMinimisExempt,
        otherBenefitsPool,
        mweTaxableSupplementaryCompensation,
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
      provisionalPayrollRunId: options.includePayrollRunId ?? null,
      importedHistoryRows: importedHistory.length,
      refunds: refunds.length,
      collections: collections.length,
    },
  });

  return {
    taxYear,
    runsIncluded: runIds.length,
    provisionalPayrollRunId: options.includePayrollRunId ?? null,
    importedHistoryRows: importedHistory.length,
    employees: rows.length,
    refunds: refunds.length,
    collections: collections.length,
    totalRefund: Number(refunds.reduce((sum, row) => sum + Math.abs(row.result.adjustment), 0).toFixed(2)),
    totalCollect: Number(collections.reduce((sum, row) => sum + row.result.adjustment, 0).toFixed(2)),
    ruleVersion: ANNUALIZATION_RULE_VERSION,
  };
}


export async function applyYearEndAdjustmentsToPayrollRun(input: {
  organizationId: number;
  taxYear: number;
  payrollRunId: number;
  actor: string;
}) {
  const [run] = await db.select().from(payrollRuns).where(and(
    eq(payrollRuns.id, input.payrollRunId),
    eq(payrollRuns.organizationId, input.organizationId),
  )).limit(1);
  if (!run) throw new Error("Year-end payroll run not found.");
  if (run.status !== "Needs review") {
    throw new Error("Year-end tax can be staged only while the payroll run is in Needs review status.");
  }
  if (String(run.payDate).slice(0, 4) !== String(input.taxYear) || String(run.periodEnd) !== `${input.taxYear}-12-31`) {
    throw new Error("Year-end tax can be staged only into the final December cutoff for the same tax year.");
  }

  const adjustments = await db.select().from(yearEndAdjustments).where(and(
    eq(yearEndAdjustments.organizationId, input.organizationId),
    eq(yearEndAdjustments.taxYear, input.taxYear),
  ));
  if (adjustments.length === 0) throw new Error("Run year-end annualization before applying tax adjustments.");
  const alreadySettled = adjustments.find((row) => row.appliedPayrollRunId != null || row.appliedAt != null);
  if (alreadySettled) {
    throw new Error("A year-end tax adjustment has already been settled into payroll and cannot be staged again.");
  }

  const entries = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
  const entryByEmployee = new Map(entries.map((entry) => [entry.employeeId, entry]));
  const adjustmentEmployeeIds = [...new Set(adjustments.map((row) => row.employeeId))];
  const adjustmentEmployees = adjustmentEmployeeIds.length
    ? await db.select().from(employees).where(and(
        eq(employees.organizationId, input.organizationId),
        inArray(employees.id, adjustmentEmployeeIds),
      ))
    : [];
  const employeeById = new Map(adjustmentEmployees.map((employee) => [employee.id, employee]));
  let totalAdjustment = 0;
  let staged = 0;
  let skippedInactive = 0;

  await db.transaction(async (tx) => {
    for (const adjustment of adjustments) {
      const delta = Number(adjustment.adjustment);
      if (!Number.isFinite(delta)) {
        throw new Error(`Year-end tax adjustment #${adjustment.id} is not a valid monetary amount.`);
      }
      const entry = entryByEmployee.get(adjustment.employeeId);
      if (!entry) {
        const employee = employeeById.get(adjustment.employeeId);
        if (employee && employee.status !== "Active") {
          // Separated/inactive employees are handled by the offboarding final-pay
          // annualization path and must not be injected into an active December run.
          skippedInactive += 1;
          continue;
        }
        throw new Error(
          `Active year-end adjustment employee #${adjustment.employeeId} is missing from the final payroll run. Recalculate the complete payroll scope before applying annualization.`,
        );
      }

      const existingLines = Array.isArray(entry.lineItems)
        ? entry.lineItems as Array<{ code?: string; label?: string; amount?: string | number; notes?: string[] }>
        : [];
      const otherLines = existingLines.filter((line) => !String(line.code ?? "").startsWith("YEAR_END_TAX-"));
      const lineAmount = -delta;
      const newDeductions = Number((Number(entry.deductions) + delta).toFixed(2));
      const newNet = Number((Number(entry.grossPay) - newDeductions).toFixed(2));
      if (newNet < -0.005) {
        throw new Error(
          `Year-end tax collection for employee #${adjustment.employeeId} exceeds available pay by PHP ${Math.abs(newNet).toFixed(2)}. Resolve the collection plan before release; payroll will not clamp net pay to zero.`,
        );
      }

      const line = {
        code: `YEAR_END_TAX-${adjustment.id}`,
        label: delta < 0 ? "Year-end tax annualization refund" : "Year-end tax annualization collection",
        amount: lineAmount.toFixed(2),
        notes: [
          `Tax year ${input.taxYear}`,
          `Annual tax due PHP ${Number(adjustment.taxDue).toFixed(2)}`,
          `Tax withheld before annualization PHP ${Number(adjustment.taxWithheld).toFixed(2)}`,
        ],
      };

      const trace = entry.trace && typeof entry.trace === "object"
        ? entry.trace as Record<string, unknown>
        : {};
      const traceInputs = Array.isArray(trace.inputs) ? trace.inputs.filter((item) =>
        typeof item !== "string" || (!item.startsWith("yearEndTaxAdjustmentId=") && !item.startsWith("yearEndTaxAdjustment="))
      ) : [];

      await tx.update(payrollEntries).set({
        deductions: newDeductions.toFixed(2),
        netPay: newNet.toFixed(2),
        lineItems: [...otherLines, line],
        trace: {
          ...trace,
          inputs: [
            ...traceInputs,
            `yearEndTaxAdjustmentId=${adjustment.id}`,
            `yearEndTaxAdjustment=${delta.toFixed(2)}`,
          ],
        },
      }).where(eq(payrollEntries.id, entry.id));

      const [payslip] = await tx.select().from(payslips).where(eq(payslips.payrollEntryId, entry.id)).limit(1);
      if (payslip) {
        const note = delta < 0
          ? `Year-end tax refund: PHP ${Math.abs(delta).toFixed(2)}`
          : `Year-end tax collection: PHP ${delta.toFixed(2)}`;
        const baseContent = payslip.content.replace(/\nYear-end tax (refund|collection): PHP [\d,.]+\s*$/i, "");
        await tx.update(payslips).set({ content: `${baseContent}\n${note}` }).where(eq(payslips.id, payslip.id));
      }

      totalAdjustment += delta;
      staged += 1;
    }

    await tx.update(payrollRuns).set({
      netPay: (Number(run.netPay) - totalAdjustment).toFixed(2),
    }).where(and(
      eq(payrollRuns.id, run.id),
      eq(payrollRuns.status, "Needs review"),
    ));
  });

  await recordAuditEvent({
    organizationId: input.organizationId,
    actor: input.actor,
    action: "Year-end tax adjustments staged",
    resource: run.periodLabel,
    metadata: {
      taxYear: input.taxYear,
      payrollRunId: run.id,
      staged,
      skippedInactive,
      totalAdjustment: Number(totalAdjustment.toFixed(2)),
      settlementDeferredUntilRelease: true,
    },
  });

  return {
    payrollRunId: run.id,
    staged,
    skippedInactive,
    totalAdjustment: Number(totalAdjustment.toFixed(2)),
    netPay: Number((Number(run.netPay) - totalAdjustment).toFixed(2)),
  };
}
