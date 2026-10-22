import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  governmentFilingValidations,
  organizations,
  payrollRuns,
  statutoryRemittanceBatches,
  statutoryRemittanceMembers,
} from "@/db/schema";
import { findFilingForm, provesOperationalFiling } from "@/lib/filing-evidence";
import { buildComplianceCalendar, type CalendarBatch, type ComplianceCalendarItem } from "@/lib/compliance-calendar";

export function manilaDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Tax years whose annual BIR obligations are in their Nov–Apr window today. */
export function annualTaxYearCandidates(today: string, payYears: number[]) {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const candidate = month >= 11 ? year : month <= 4 ? year - 1 : null;
  return candidate != null && payYears.includes(candidate) ? [candidate] : [];
}


type ScopedCalendarRun = { periodEnd: string; payDate: string; legalEntityId: number | null };
type ScopedCalendarBatch = CalendarBatch & { legalEntityId: number };
const validEntityId = (value: number | null): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

/**
 * One organization-wide calendar row represents ALL legal employers with
 * payroll or a remittance batch in that month. A single reconciled entity
 * cannot hide an open, missing, or unscoped sibling employer.
 */
export function aggregateEmployerRemittanceBatches(
  runs: Pick<ScopedCalendarRun, "periodEnd" | "legalEntityId">[],
  batches: ScopedCalendarBatch[],
  months: readonly string[],
): CalendarBatch[] {
  const result: CalendarBatch[] = [];
  for (const applicableMonth of months) {
    const periodRuns = runs.filter(run => String(run.periodEnd).slice(0, 7) === applicableMonth);
    const requiredEntityIds = new Set(periodRuns.map(run => run.legalEntityId).filter(validEntityId));
    const hasUnscopedRun = periodRuns.length === 0 || periodRuns.some(run => !validEntityId(run.legalEntityId));

    for (const agency of ["SSS", "PhilHealth", "Pag-IBIG"] as const) {
      const related = batches.filter(batch => batch.applicableMonth === applicableMonth && batch.agency === agency);
      if (!related.length) continue; // The regular calendar shows the unopened liability.
      const byEntity = new Map(related.map(batch => [batch.legalEntityId, batch]));
      const missingEntity = [...requiredEntityIds].some(id => !byEntity.has(id));
      const duplicateEntity = byEntity.size !== related.length;
      const pendingPostingCount = related.reduce((sum, batch) => sum + batch.pendingPostingCount, 0);
      const exceptionCount = related.reduce((sum, batch) => sum + batch.exceptionCount, 0);
      const fullyReconciled = !hasUnscopedRun && !missingEntity && !duplicateEntity &&
        related.every(batch => batch.status === "reconciled" &&
          batch.pendingPostingCount === 0 && batch.exceptionCount === 0);
      const hasException = exceptionCount > 0 || related.some(batch => batch.status === "exception");
      const onlyPaidOrReconciled = related.every(batch =>
        batch.status === "paid" || batch.status === "reconciled");
      const status = fullyReconciled ? "reconciled"
        : hasException ? "exception"
        : hasUnscopedRun || missingEntity || duplicateEntity ? "verification-required"
        : pendingPostingCount > 0 && onlyPaidOrReconciled ? "paid" : "open";

      result.push({
        agency, applicableMonth, status,
        dueDate: related.map(batch => batch.dueDate).filter(Boolean).sort()[0] ?? "",
        pendingPostingCount, exceptionCount,
      });
    }
  }
  return result;
}

/** BIR 1601-C clearance also requires filing evidence for EVERY pay-month legal employer. */
export function fullyConfirmedBirMonths(
  runs: Pick<ScopedCalendarRun, "payDate" | "legalEntityId">[],
  accepted: Array<{ payDate: string; legalEntityId: number; payrollRunLegalEntityId: number | null }>,
  months: readonly string[],
): string[] {
  return months.filter(month => {
    const payRuns = runs.filter(run => String(run.payDate).slice(0, 7) === month);
    if (!payRuns.length || payRuns.some(run => !validEntityId(run.legalEntityId))) return false;
    const required = new Set(payRuns.map(run => run.legalEntityId).filter(validEntityId));
    const verified = new Set(accepted.filter(row =>
      String(row.payDate).slice(0, 7) === month &&
      validEntityId(row.legalEntityId) && row.legalEntityId === row.payrollRunLegalEntityId,
    ).map(row => row.legalEntityId));
    return required.size > 0 && [...required].every(id => verified.has(id));
  });
}

export type LoadedComplianceCalendar =
  | { kind: "not-found" }
  | { kind: "empty"; today: string }
  | { kind: "ready"; today: string; applicableMonths: string[]; payrollMonths: string[]; birMonths: string[]; annualTaxYears: number[]; items: ComplianceCalendarItem[]; organizationName: string };

export async function loadComplianceCalendar(organizationId: number, today = manilaDate()): Promise<LoadedComplianceCalendar> {
  const [organization] = await db.select().from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!organization) return { kind: "not-found" };

  const runs = await db.select({
    periodEnd: payrollRuns.periodEnd,
    payDate: payrollRuns.payDate,
    legalEntityId: payrollRuns.legalEntityId,
  }).from(payrollRuns)
    .where(eq(payrollRuns.organizationId, organizationId))
    .orderBy(desc(payrollRuns.periodEnd), desc(payrollRuns.id))
    .limit(24);

  const applicableMonths = [...new Set(
    runs.map((run) => String(run.periodEnd).slice(0, 7)),
  )].slice(0, 4);
  const birApplicableMonths = [...new Set(
    runs.map((run) => String(run.payDate).slice(0, 7)),
  )].slice(0, 4);

  if (applicableMonths.length === 0) return { kind: "empty", today };

  const batches = await db.select().from(statutoryRemittanceBatches)
    .where(and(
      eq(statutoryRemittanceBatches.organizationId, organizationId),
      inArray(statutoryRemittanceBatches.applicableMonth, applicableMonths),
    ))
    .orderBy(asc(statutoryRemittanceBatches.applicableMonth), asc(statutoryRemittanceBatches.agency));

  const batchIds = batches.map((batch) => batch.id);
  const members = batchIds.length
    ? await db.select({
        batchId: statutoryRemittanceMembers.batchId,
        postingStatus: statutoryRemittanceMembers.postingStatus,
      }).from(statutoryRemittanceMembers)
        .where(inArray(statutoryRemittanceMembers.batchId, batchIds))
    : [];

  const bir1601Definition = findFilingForm("BIR", "1601-C");
  const bir1601Evidence = bir1601Definition
    ? await db.select({
        agency: governmentFilingValidations.agency,
        form: governmentFilingValidations.form,
        status: governmentFilingValidations.status,
        submissionMethod: governmentFilingValidations.submissionMethod,
        generatorVersion: governmentFilingValidations.generatorVersion,
        agencyReference: governmentFilingValidations.agencyReference,
        submittedAt: governmentFilingValidations.submittedAt,
        payDate: payrollRuns.payDate,
        legalEntityId: governmentFilingValidations.legalEntityId,
        payrollRunLegalEntityId: payrollRuns.legalEntityId,
      })
        .from(governmentFilingValidations)
        .innerJoin(payrollRuns, eq(governmentFilingValidations.payrollRunId, payrollRuns.id))
        .where(and(
          eq(governmentFilingValidations.organizationId, organizationId),
          eq(governmentFilingValidations.agency, "BIR"),
          eq(governmentFilingValidations.form, "1601-C"),
        ))
    : [];
  const bir1601cOperationalMonths = bir1601Definition
    ? fullyConfirmedBirMonths(
        runs,
        bir1601Evidence.filter(row => provesOperationalFiling(row, bir1601Definition)),
        birApplicableMonths,
      )
    : [];

  const payYears = [...new Set(runs.map((run) => Number(String(run.payDate).slice(0, 4))))];
  const annualTaxYears = annualTaxYearCandidates(today, payYears);
  const items = buildComplianceCalendar({
    today,
    currentMonth: today.slice(0, 7),
    applicableMonths,
    birApplicableMonths,
    legalName: organization.legalName,
    philHealthEmployerNo: organization.philHealthEmployerNo,
    bir1601cOperationalMonths,
    annualTaxYears,
    batches: aggregateEmployerRemittanceBatches(runs, batches.map((batch) => ({
      legalEntityId: batch.legalEntityId,
      agency: batch.agency,
      applicableMonth: batch.applicableMonth,
      dueDate: String(batch.dueDate),
      status: batch.status,
      pendingPostingCount: members.filter(
        (member) => member.batchId === batch.id && member.postingStatus === "pending",
      ).length,
      exceptionCount: members.filter(
        (member) => member.batchId === batch.id && member.postingStatus === "exception",
      ).length,
    })), applicableMonths),
  });

  return {
    kind: "ready",
    today,
    applicableMonths: [...new Set([...applicableMonths, ...birApplicableMonths])],
    payrollMonths: applicableMonths,
    birMonths: birApplicableMonths,
    annualTaxYears,
    items,
    organizationName: organization.name,
  };
}
