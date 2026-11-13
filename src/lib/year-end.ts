import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, employees, historicalPayrollEntries, legalEntities, payrollEntries, payrollRuns, yearEndAdjustments } from "@/db/schema";
import { ensureMigrationSchema } from "@/lib/migration-schema";
import { annualize, ANNUALIZATION_RULE_VERSION, isSharedBenefitPoolEarningType, type AnnualizationResult } from "@/lib/annualization";
import { readBasicAndThirteenth, retroSourceTaxYear } from "@/lib/final-pay";
import { round2 } from "@/lib/round";
import { loadFinalPayRetroSourcePeriods } from "@/lib/final-pay-retro-source-lookup";
import { priorEvidenceEnabled, priorEmployeeScope, readPriorEvidence } from "./year-end-prior-evidence-server";
import { annualizeWithPrior } from "./year-end-prior-evidence";
import { criticalReleaseFlagEnabled } from "./critical-release-flags";
import { thirteenthMonthFromCentavos } from "./thirteenth-month-centavos";
import { DE_MINIMIS_2026, deMinimisStatutoryPeriodStart, type DeMinimisType } from "./ph-compliance";

/**
 * Imported payroll history can carry the previous provider's de minimis totals by statutory category
 * (importer field deMinimisBreakdown). Each category is capped at its RR 29-2025 ceiling per statutory
 * period (month, semester or year, by pay date). The part inside the ceiling is exempt; the part above it
 * enters the shared 90,000 benefit pool, exactly as the engine treats its own de minimis lines.
 * Categories whose ceiling is not a peso amount per period (days of monetized leave, a daily meal allowance
 * that depends on eligible days and the wage order) cannot be proven from imported totals and are refused.
 *
 * A worker whose previous provider's months are imported and whose later months the engine calculated shares
 * ONE statutory ceiling per category and period across both sources. The engine's own de minimis lines for the same
 * worker are therefore passed in (engineLines) and counted in the same period totals: the ceiling is applied once to
 * the union, never once per source.
 */
export function importedDeMinimisTreatment(rows: ReadonlyArray<{
  id: number;
  payDate: string;
  grossPay: number | string;
  deMinimisBreakdown: unknown;
}>, engineLines: ReadonlyArray<{ category: DeMinimisType; payDate: string; amount: number }> = []) {
  const paid = new Map<string, number>();
  for (const line of engineLines) {
    if (!(line.amount > 0)) continue;
    const periodKey = `${line.category}|${deMinimisStatutoryPeriodStart(line.category, line.payDate)}`;
    paid.set(periodKey, (paid.get(periodKey) ?? 0) + line.amount);
  }
  for (const row of rows) {
    const breakdown = row.deMinimisBreakdown;
    if (breakdown === null || breakdown === undefined) continue;
    if (typeof breakdown !== "object" || Array.isArray(breakdown)) {
      throw new Error(`Imported payroll history row #${row.id} has an unreadable de minimis breakdown. Re-import it before running year-end annualization.`);
    }
    let rowTotal = 0;
    for (const [key, raw] of Object.entries(breakdown as Record<string, unknown>)) {
      const amount = Number(raw);
      if (!Number.isFinite(amount) || amount < 0) {
        throw new Error(`Imported payroll history row #${row.id} has an invalid de minimis amount for "${key}".`);
      }
      if (amount === 0) continue;
      const rule = (DE_MINIMIS_2026 as Record<string, { ceiling?: number }>)[key];
      if (!rule) {
        throw new Error(`Imported payroll history row #${row.id} has an unknown de minimis category "${key}".`);
      }
      if (typeof rule.ceiling !== "number" || key === "monetizedVacationLeaveDays") {
        throw new Error(
          `Imported payroll history row #${row.id} reports "${key}", whose statutory ceiling cannot be applied to imported totals. Resolve this employee's de minimis outside Linaw and record the verified adjustment.`,
        );
      }
      rowTotal += amount;
      const periodKey = `${key}|${deMinimisStatutoryPeriodStart(key as DeMinimisType, row.payDate)}`;
      paid.set(periodKey, (paid.get(periodKey) ?? 0) + amount);
    }
    if (round2(rowTotal) > round2(Number(row.grossPay))) {
      throw new Error(`Imported payroll history row #${row.id} reports more de minimis (${round2(rowTotal)}) than gross pay (${round2(Number(row.grossPay))}).`);
    }
  }
  let exempt = 0;
  let excess = 0;
  for (const [periodKey, amount] of paid) {
    const ceiling = (DE_MINIMIS_2026 as Record<string, { ceiling?: number }>)[periodKey.split("|")[0]].ceiling as number;
    const within = Math.min(amount, ceiling);
    exempt += within;
    excess += amount - within;
  }
  return { exempt: round2(exempt), excess: round2(excess) };
}

type LineItem = {
  code?: string;
  label?: string;
  amount?: number | string;
  notes?: string[];
  periodOtherBenefitsPool?: number;
  benefitPool90k?: boolean;
  benefitPoolKind?: string;
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
  let deMinimisExcess = 0;
  let otherBenefits = 0;
  let mweTaxableSupplementaryCompensation = traceNumber(trace, "mweTaxableSupplementaryCompensation=");

  for (const item of items) {
    const signedAmount = Number(item.amount ?? 0);
    const amount = Math.abs(signedAmount);
    if (!Number.isFinite(amount)) continue;
    const code = String(item.code ?? "").toUpperCase();
    const label = `${item.code ?? ""} ${item.label ?? ""}`.toLowerCase();

    const noteType = (item.notes ?? [])
      .find((note) => String(note).startsWith("Type: "))
      ?.slice("Type: ".length);
    const benefitKind = String(item.benefitPoolKind ?? noteType ?? "");
    const isThirteenth =
      benefitKind === "13th_month"
      || benefitKind === "thirteenth_month"
      || label.includes("13th month")
      || label.includes("thirteenth month");

    if (
      code !== "HDMF_VOL"
      && (label.includes("sss") || label.includes("philhealth") || label.includes("pag-ibig") || label.includes("pagibig"))
    ) {
      contributions += amount;
    } else if (code.startsWith("YE-TAX-")) {
      // Payroll stores year-end settlement using the line-item sign convention:
      // collection = negative line, refund = positive line. Reconstruct actual
      // tax withheld net of refunds rather than taking an absolute value.
      tax += -signedAmount;
    } else if (label.includes("withholding") || label.includes("tax")) {
      tax += amount;
    }

    if (isThirteenth) {
      thirteenth += Math.max(0, signedAmount);
    } else if (
      code.startsWith("EARN-")
      && (
        item.benefitPool90k === true
        || isSharedBenefitPoolEarningType(benefitKind)
      )
    ) {
      otherBenefits += Math.max(0, signedAmount);
    }

    if (code.startsWith("EXP-")) {
      reimbursements += Math.max(0, signedAmount);
    }

    if (code.startsWith("DM-")) {
      const poolAmount = Math.max(0, Number(item.periodOtherBenefitsPool ?? 0));
      deMinimisExcess += poolAmount;
      deMinimisExempt += Math.max(0, signedAmount - poolAmount);
    }

  }

  return {
    contributions,
    tax,
    thirteenth,
    reimbursements,
    deMinimisExempt,
    deMinimisExcess,
    otherBenefits,
    mweTaxableSupplementaryCompensation: Math.max(0, mweTaxableSupplementaryCompensation),
  };
}

type YearEndTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type BoundYearEndSummary = {
  refunds: number;
  collections: number;
  totalRefund: number;
  totalCollect: number;
};

/**
 * Aggregates every released payroll entry for the tax year and runs the
 * December annualization for each employee. Idempotent: re-running replaces
 * that year's adjustments for the organization.
 */
export async function runYearEndAnnualization(
  organizationId: number,
  taxYear: number,
  actor: string,
  options: {
    includePayrollRunId?: number;
    bindToPayrollRunId?: number;
    approvedBy?: string;
    onBoundToPayrollRun?: (tx: YearEndTransaction, summary: BoundYearEndSummary) => Promise<void>;
  } = {},
) {
  // A payroll binding must never persist approved/settled adjustments unless
  // the same transaction also completes the matching queue and audit writes.
  if (options.bindToPayrollRunId != null &&
      (options.includePayrollRunId !== options.bindToPayrollRunId || !options.onBoundToPayrollRun)) {
    throw new Error("YEAR_END_BINDING_REQUIRES_MATCHED_RUN_AND_ATOMIC_CALLBACK");
  }
  if (options.onBoundToPayrollRun && options.bindToPayrollRunId == null) {
    throw new Error("YEAR_END_UNBOUND_CALLBACK_NOT_ALLOWED");
  }

  await ensureMigrationSchema();
  const usePriorEvidence = priorEvidenceEnabled();
  if (usePriorEvidence && criticalReleaseFlagEnabled("multiEntity")) throw new Error("PRIOR_MULTI_ENTITY_DEFERRED");

  // All source reads, calculations, adjustment replacement and audit evidence
  // share ONE serializable database snapshot. A failure rolls back the old
  // adjustment deletion as well as any inserted replacements.
  return db.transaction(async tx => {
    // Serialize competing annualization requests for the same employer/year.
    // A different employer or tax year does not share this advisory lock.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(
      hashtext('payrollph.year-end.annualization'),
      hashtext(${organizationId}::text || ':' || ${taxYear}::text)
    )`);

  const releasedRuns = await tx
    .select()
    .from(payrollRuns)
    .where(and(
      eq(payrollRuns.organizationId, organizationId),
      eq(payrollRuns.status, "Released"),
      sql`extract(year from ${payrollRuns.payDate}) = ${taxYear}`,
    ));

  let includedRun: typeof payrollRuns.$inferSelect | null = null;
  if (options.includePayrollRunId != null) {
    const [candidate] = await tx.select().from(payrollRuns).where(and(
      eq(payrollRuns.id, options.includePayrollRunId),
      eq(payrollRuns.organizationId, organizationId),
    )).limit(1);
    if (!candidate) throw new Error("The payroll run selected for year-end annualization was not found in this organization.");
    if (Number(String(candidate.payDate).slice(0, 4)) !== taxYear) {
      throw new Error("The payroll run selected for year-end annualization must have a pay date in the requested tax year.");
    }
    if (candidate.status !== "Needs review") {
      throw new Error("Apply year-end tax only to a freshly calculated payroll run in Needs review status.");
    }
    // Recheck the December cutoff inside the serializable snapshot, not only
    // in the HTTP preflight where the payroll run could have changed.
    if (options.bindToPayrollRunId != null && !String(candidate.periodEnd).endsWith("-12-31")) {
      throw new Error("YEAR_END_BINDING_REQUIRES_DECEMBER_31_CUTOFF");
    }
    includedRun = candidate;
  }

  const runs = includedRun && !releasedRuns.some((run) => run.id === includedRun!.id)
    ? [...releasedRuns, includedRun]
    : releasedRuns;
  const runIds = runs.map((run) => run.id);
  const staff = await tx.select().from(employees).where(eq(employees.organizationId, organizationId));
  if (usePriorEvidence) {
    const entities = await tx.select().from(legalEntities).where(eq(legalEntities.organizationId, organizationId));
    const entityId = entities[0]?.id ?? null;
    if (entities.length > 1 || (entities.length === 1 && !entities[0].active) ||
      runs.some(run => run.legalEntityId !== null && run.legalEntityId !== entityId) ||
      staff.some(worker => worker.legalEntityId !== null && worker.legalEntityId !== entityId)) {
      throw new Error("PRIOR_MULTI_ENTITY_DEFERRED");
    }
  }

  const entries = runIds.length
    ? await tx.select().from(payrollEntries).where(inArray(payrollEntries.payrollRunId, runIds))
    : [];

  // A company can switch payroll providers mid-year. Imported payroll history is
  // preserved as source-of-truth totals and participates in annualization without
  // being recalculated under the current Linaw rule tables.
  const importedHistory = await tx
    .select()
    .from(historicalPayrollEntries)
    .where(and(
      eq(historicalPayrollEntries.organizationId, organizationId),
      sql`extract(year from ${historicalPayrollEntries.payDate}) = ${taxYear}`,
    ));

  // M-5: a later-year RETRO-* settlement changes gross/tax cashflow in the
  // pay year, but its 13th-month BASIC belongs to the verified original year.
  // Reject missing, Draft, foreign-tenant, wrong-worker and cross-year sources
  // instead of assuming the settlement's pay date is the source year.
  const adjustmentIdsByEmployee = new Map<number, Set<number>>();
  const employeeIds = new Set(staff.map((employee) => employee.id));
  for (const entry of entries) {
    if (!employeeIds.has(entry.employeeId)) {
      throw new Error("FINAL_PAY_RETRO_SOURCE_YEAR_UNVERIFIED: released payroll contains a foreign worker.");
    }
    if (!Array.isArray(entry.lineItems)) continue;
    for (const item of entry.lineItems) {
      const code = String((item as { code?: unknown } | null)?.code ?? "").toUpperCase();
      if (!code.startsWith("RETRO-")) continue;
      const match = /^RETRO-(\d+)$/.exec(code);
      const id = match ? Number(match[1]) : NaN;
      if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error("FINAL_PAY_RETRO_SOURCE_YEAR_UNVERIFIED: invalid settled retro adjustment identity.");
      }
      const ids = adjustmentIdsByEmployee.get(entry.employeeId) ?? new Set<number>();
      ids.add(id);
      adjustmentIdsByEmployee.set(entry.employeeId, ids);
    }
  }
  const sourceYearsByEmployee = new Map<number, Map<number, number | null>>();
  for (const [employeeId, adjustmentIds] of adjustmentIdsByEmployee) {
    const sources = await loadFinalPayRetroSourcePeriods({
      organizationId, employeeId, adjustmentIds: [...adjustmentIds],
    }, tx);
    sourceYearsByEmployee.set(employeeId, new Map(sources.map((row) => [
      row.id, retroSourceTaxYear(String(row.sourcePeriodStart), String(row.sourcePeriodEnd)),
    ])));
  }

  const totals = new Map<number, {
    gross: number;
    basic: number;
    contributions: number;
    tax: number;
    thirteenthPaid: number;
    deMinimisExempt: number;
    deMinimisExcess: number;
    otherBenefits: number;
    mweTaxableSupplementaryCompensation: number;
    periods: number;
    importedPeriods: number;
  }>();
  for (const entry of entries) {
    const bucket = totals.get(entry.employeeId) ?? { gross: 0, basic: 0, contributions: 0, tax: 0, thirteenthPaid: 0, deMinimisExempt: 0, deMinimisExcess: 0, otherBenefits: 0, mweTaxableSupplementaryCompensation: 0, periods: 0, importedPeriods: 0 };
    const parsed = sumContributionsAndTax(entry.lineItems, entry.trace);
    const basic = readBasicAndThirteenth(entry.lineItems, {
      taxYear,
      sourceYearByAdjustmentId: sourceYearsByEmployee.get(entry.employeeId) ?? new Map(),
    });
    bucket.gross += Math.max(0, Number(entry.grossPay) - parsed.reimbursements);
    bucket.basic += basic.basic;
    bucket.contributions += parsed.contributions;
    bucket.tax += parsed.tax;
    bucket.thirteenthPaid += parsed.thirteenth;
    bucket.deMinimisExempt += parsed.deMinimisExempt;
    bucket.deMinimisExcess += parsed.deMinimisExcess;
    bucket.otherBenefits += parsed.otherBenefits;
    bucket.mweTaxableSupplementaryCompensation += parsed.mweTaxableSupplementaryCompensation;
    bucket.periods += 1;
    totals.set(entry.employeeId, bucket);
  }

  for (const entry of importedHistory) {
    const bucket = totals.get(entry.employeeId) ?? { gross: 0, basic: 0, contributions: 0, tax: 0, thirteenthPaid: 0, deMinimisExempt: 0, deMinimisExcess: 0, otherBenefits: 0, mweTaxableSupplementaryCompensation: 0, periods: 0, importedPeriods: 0 };
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
  const importedByEmployee = new Map<number, typeof importedHistory>();
  for (const entry of importedHistory) {
    importedByEmployee.set(entry.employeeId, [...(importedByEmployee.get(entry.employeeId) ?? []), entry]);
  }
  const runPayDate = new Map(runs.map((run) => [run.id, String(run.payDate)]));
  for (const [employeeId, employeeRows] of importedByEmployee) {
    const importedRowsForTreatment = employeeRows.map((row) => ({
      id: row.id,
      payDate: String(row.payDate),
      grossPay: row.grossPay,
      deMinimisBreakdown: row.deMinimisBreakdown,
    }));
    const bucket = totals.get(employeeId);
    // Without any imported de minimis amount there is nothing to share a ceiling with; the engine's own accounting stands.
    const importedTreatment = importedDeMinimisTreatment(importedRowsForTreatment);
    if (!bucket) continue;
    const hasImportedDeMinimis = importedTreatment.exempt + importedTreatment.excess > 0;
    // The engine's fixed-ceiling de minimis lines for the same worker join the imported ones in ONE statutory ceiling.
    const engineLines: Array<{ category: DeMinimisType; payDate: string; amount: number }> = [];
    let engineExempt = 0;
    let engineExcess = 0;
    if (hasImportedDeMinimis) {
      for (const entry of entries) {
        if (entry.employeeId !== employeeId || !Array.isArray(entry.lineItems)) continue;
        const payDate = runPayDate.get(entry.payrollRunId);
        if (!payDate) continue;
        for (const item of entry.lineItems as LineItem[]) {
          const code = String(item.code ?? "");
          if (!code.startsWith("DM-")) continue;
          const category = code.slice(3);
          const rule = (DE_MINIMIS_2026 as Record<string, { ceiling?: number }>)[category];
          // Meal allowance (a daily, wage-order based ceiling) and leave days stay exactly as the engine accounted them.
          if (!rule || typeof rule.ceiling !== "number" || category === "monetizedVacationLeaveDays") continue;
          const amount = Math.max(0, Number(item.amount ?? 0));
          const pool = Math.max(0, Number(item.periodOtherBenefitsPool ?? 0));
          engineExempt += Math.max(0, amount - pool);
          engineExcess += pool;
          engineLines.push({ category: category as DeMinimisType, payDate, amount });
        }
      }
    }
    const treatment = importedDeMinimisTreatment(importedRowsForTreatment, engineLines);
    // The union replaces the engine's separately capped figures for these categories.
    bucket.deMinimisExempt += treatment.exempt - round2(engineExempt);
    bucket.deMinimisExcess += treatment.excess - round2(engineExcess);
  }

  const existingAdjustments = await tx.select().from(yearEndAdjustments).where(and(
    eq(yearEndAdjustments.organizationId, organizationId),
    eq(yearEndAdjustments.taxYear, taxYear),
  ));
  if (existingAdjustments.some((row) => row.status === "settled")) {
    throw new Error(
      `Year-end tax adjustments for ${taxYear} have already been settled in payroll and cannot be recomputed in place. Use a separately audited correction instead.`,
    );
  }
  // Approved or run-bound adjustments are immutable, whether the request is bound or not and whether or not an
  // optional feature flag or breakdown marker is present. Deleting one would silently drop the numbered year-end
  // tax line from a payroll run that was already queued against it.
  // The single exception: an unmarked approved row whose run can no longer be paid (failed, cancelled, voided or
  // superseded) is released, so a replacement final cutoff can be annualized. A live run, a settled row, a row with
  // a prior-evidence or rounding-policy marker, or a request made while the prior-evidence flag is on stays blocked.
  const UNPAYABLE_RUN_STATUSES = new Set(["Failed", "Cancelled", "Voided", "Superseded"]);
  const linkedRunIds = [...new Set(existingAdjustments.flatMap(row => (row.payrollRunId === null ? [] : [row.payrollRunId])))];
  const linkedRuns = linkedRunIds.length
    ? await tx.select({ id: payrollRuns.id, status: payrollRuns.status }).from(payrollRuns)
      .where(and(eq(payrollRuns.organizationId, organizationId), inArray(payrollRuns.id, linkedRunIds)))
    : [];
  const linkedRunStatus = new Map(linkedRuns.map(run => [run.id, run.status]));
  const hasOptionalMarker = (row: typeof existingAdjustments[number]) => row.breakdown !== null &&
    typeof row.breakdown === "object" && !Array.isArray(row.breakdown) &&
    ("priorEvidence" in row.breakdown || "thirteenthRoundingPolicy" in row.breakdown);
  const releasedByUnpayableRun = (row: typeof existingAdjustments[number]) =>
    !usePriorEvidence && !hasOptionalMarker(row) && row.status === "approved" && row.payrollRunId !== null &&
    UNPAYABLE_RUN_STATUSES.has(linkedRunStatus.get(row.payrollRunId) ?? "");
  if (existingAdjustments.some(row => (row.status !== "computed" || row.payrollRunId !== null) && !releasedByUnpayableRun(row))) {
    throw new Error("YEAR_END_BOUND_OR_APPROVED_RECOMPUTE_BLOCKED");
  }
  // A rollback of the intake feature must never erase previously approved prior credits.
  if (!usePriorEvidence && existingAdjustments.some(row => row.breakdown !== null &&
    typeof row.breakdown === "object" && !Array.isArray(row.breakdown) && "priorEvidence" in row.breakdown)) {
    throw new Error("PRIOR_EVIDENCE_DISABLED_RECOMPUTE_BLOCKED");
  }
  // Do not delete any previous adjustment until every employee has been
  // calculated. The subsequent delete/insert/audit are one atomic commit.

  const rows: Array<{
    employee: typeof staff[number];
    result: AnnualizationResult;
    periods: number;
    importedPeriods: number;
    basicSalaryEarned: number;
    thirteenthEntitlement: number;
    thirteenthAlreadyPaid: number;
    deMinimisExempt: number;
    deMinimisExcess: number;
    otherBenefits: number;
    mweTaxableSupplementaryCompensation: number;
    priorEvidence?: { id: number; revision: number; digest: string };
  }> = [];

  for (const employee of staff) {
    const bucket = totals.get(employee.id);
    if (!bucket || bucket.periods === 0) continue;

    // DOLE minimum 13th month: total basic salary actually earned in the
    // calendar year divided by 12. Do not infer from the employee's current
    // salary or payroll-period count because rate changes and unpaid time make
    // that inaccurate.
    const thirteenthEntitlement = criticalReleaseFlagEnabled("exactThirteenthCentavos")
      ? thirteenthMonthFromCentavos(round2(bucket.basic)) : Math.round(((bucket.basic / 12) + Number.EPSILON) * 100) / 100;
    const annualThirteenth = Math.max(thirteenthEntitlement, bucket.thirteenthPaid);

    if (employee.mwe && bucket.importedPeriods > 0) {
      throw new Error(
        `Imported payroll history for MWE employee ${employee.employeeNo} does not contain the statutory-wage versus taxable-supplementary breakdown required for safe annualization. Import the detailed breakdown or annualize this employee outside Linaw and record the verified adjustment.`,
      );
    }

    const unpaidThirteenthAccrual = Math.max(0, annualThirteenth - bucket.thirteenthPaid);
    let result = annualize({
      grossCompensation: bucket.gross + unpaidThirteenthAccrual,
      thirteenthMonth: annualThirteenth,
      otherBenefits: bucket.otherBenefits,
      deMinimis: bucket.deMinimisExempt,
      deMinimisExcess: bucket.deMinimisExcess,
      statutoryContributions: bucket.contributions,
      taxWithheld: bucket.tax,
      mwe: employee.mwe,
      mweTaxableSupplementaryCompensation: employee.mwe
        ? bucket.mweTaxableSupplementaryCompensation
        : 0,
    });

    let priorEvidence: { id: number; revision: number; digest: string } | undefined;
    if (usePriorEvidence) {
      const scope = await priorEmployeeScope(tx, { organizationId, employeeId: employee.id, taxYear });
      const approved = await readPriorEvidence(tx, scope, true);
      if (!approved) throw new Error("PRIOR_APPROVED_EVIDENCE_REQUIRED");
      result = annualizeWithPrior(result, approved.evidence, taxYear);
      priorEvidence = { id: approved.row.id, revision: approved.row.revision, digest: approved.row.sourceDigest };
    }
    rows.push({
      employee,
      result,
      priorEvidence,
      periods: bucket.periods,
      importedPeriods: bucket.importedPeriods,
      basicSalaryEarned: bucket.basic,
      thirteenthEntitlement,
      thirteenthAlreadyPaid: bucket.thirteenthPaid,
      deMinimisExempt: bucket.deMinimisExempt,
      deMinimisExcess: bucket.deMinimisExcess,
      otherBenefits: bucket.otherBenefits,
      mweTaxableSupplementaryCompensation: employee.mwe
        ? bucket.mweTaxableSupplementaryCompensation
        : 0,
    });
  }

  // Recheck settled adjustments while holding the transaction's lock; no
  // concurrent annualization may interleave its read/delete/replacement.
  await tx.delete(yearEndAdjustments).where(and(
    eq(yearEndAdjustments.organizationId, organizationId),
    eq(yearEndAdjustments.taxYear, taxYear),
  ));

  if (rows.length) {
    await tx.insert(yearEndAdjustments).values(rows.map(({
      employee,
      result,
      periods,
      priorEvidence,
      importedPeriods,
      basicSalaryEarned,
      thirteenthEntitlement,
      thirteenthAlreadyPaid,
      deMinimisExempt,
      deMinimisExcess,
      otherBenefits,
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
        ...(criticalReleaseFlagEnabled("exactThirteenthCentavos") ? { thirteenthRoundingPolicy: "centavo-half-up-v1" } : {}),
        ...(priorEvidence ? { priorEvidence } : {}),
        periodsIncluded: periods,
        runsIncluded: runIds.length,
        importedHistoryRows: importedPeriods,
        basicSalaryEarned,
        thirteenthEntitlement,
        thirteenthAlreadyPaid,
        thirteenthStillDue: round2(Math.max(0, thirteenthEntitlement - thirteenthAlreadyPaid)),
        deMinimisExempt,
        deMinimisExcess,
        otherBenefits,
        mweTaxableSupplementaryCompensation,
      },
      ruleVersion: ANNUALIZATION_RULE_VERSION,
      status: options.bindToPayrollRunId
        ? (Math.abs(result.adjustment) > 0.004 ? "approved" : "settled")
        : "computed",
      payrollRunId: options.bindToPayrollRunId ?? null,
      approvedAt: options.bindToPayrollRunId ? new Date() : null,
      approvedBy: options.bindToPayrollRunId ? (options.approvedBy ?? actor) : null,
      settledAt:
        options.bindToPayrollRunId && Math.abs(result.adjustment) <= 0.004
          ? new Date()
          : null,
    })));
  }

  const refunds = rows.filter((row) => row.result.outcome === "refund");
  const collections = rows.filter((row) => row.result.outcome === "collect");

  // Audit and financial rows must commit or roll back together.
  await tx.insert(auditEvents).values({
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
      includedPayrollRunId: options.includePayrollRunId ?? null,
      boundPayrollRunId: options.bindToPayrollRunId ?? null,
    },
  });

  const summary = {
    taxYear,
    runsIncluded: runIds.length,
    importedHistoryRows: importedHistory.length,
    employees: rows.length,
    refunds: refunds.length,
    collections: collections.length,
    totalRefund: Number(refunds.reduce((sum, row) => sum + Math.abs(row.result.adjustment), 0).toFixed(2)),
    totalCollect: Number(collections.reduce((sum, row) => sum + row.result.adjustment, 0).toFixed(2)),
    ruleVersion: ANNUALIZATION_RULE_VERSION,
    includedPayrollRunId: options.includePayrollRunId ?? null,
    boundPayrollRunId: options.bindToPayrollRunId ?? null,
  };

  // A bound final-cutoff job and its audit must commit under this same
  // serializable transaction; any queue or audit veto rolls back adjustments.
  if (options.bindToPayrollRunId != null && options.onBoundToPayrollRun) {
    await options.onBoundToPayrollRun(tx, summary);
  }
  return summary;
  }, { isolationLevel: "serializable" });
}
