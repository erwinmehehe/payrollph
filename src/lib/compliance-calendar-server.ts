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
import { buildComplianceCalendar, type ComplianceCalendarItem } from "@/lib/compliance-calendar";

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

export type LoadedComplianceCalendar =
  | { kind: "not-found" }
  | { kind: "empty"; today: string }
  | { kind: "ready"; today: string; applicableMonths: string[]; items: ComplianceCalendarItem[]; organizationName: string };

export async function loadComplianceCalendar(organizationId: number, today = manilaDate()): Promise<LoadedComplianceCalendar> {
  const [organization] = await db.select().from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!organization) return { kind: "not-found" };

  const runs = await db.select({
    periodEnd: payrollRuns.periodEnd,
    payDate: payrollRuns.payDate,
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
    ? [...new Set(
        bir1601Evidence
          .filter((row) => provesOperationalFiling(row, bir1601Definition))
          .map((row) => String(row.payDate).slice(0, 7)),
      )]
    : [];

  const payYears = [...new Set(runs.map((run) => Number(String(run.payDate).slice(0, 4))))];
  const items = buildComplianceCalendar({
    today,
    currentMonth: today.slice(0, 7),
    applicableMonths,
    birApplicableMonths,
    legalName: organization.legalName,
    philHealthEmployerNo: organization.philHealthEmployerNo,
    bir1601cOperationalMonths,
    annualTaxYears: annualTaxYearCandidates(today, payYears),
    batches: batches.map((batch) => ({
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
    })),
  });

  return {
    kind: "ready",
    today,
    applicableMonths: [...new Set([...applicableMonths, ...birApplicableMonths])],
    items,
    organizationName: organization.name,
  };
}
