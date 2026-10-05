import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  payrollEntries,
  payrollRuns,
  statutoryContributionIssueCases,
  statutoryRemittanceCorrectionRequests,
  statutoryRemittanceMonthClosures,
} from "@/db/schema";
import { evaluateRemittanceMonthClose } from "@/lib/statutory-remittance-close";
import {
  loadStatutoryRemittanceState,
  statutoryLiabilityKeys,
} from "@/lib/statutory-remittance-state";

function monthStart(month: string) {
  return `${month}-01`;
}

function monthEnd(month: string) {
  const [year, rawMonth] = month.split("-").map(Number);
  return new Date(Date.UTC(year, rawMonth, 0)).toISOString().slice(0, 10);
}

export async function loadStatutoryRemittanceMonthCloseState(
  organizationId: number,
  applicableMonth: string,
  preloadedState?: Awaited<ReturnType<typeof loadStatutoryRemittanceState>>,
) {
  const state = preloadedState === undefined
    ? await loadStatutoryRemittanceState(organizationId)
    : preloadedState;
  if (!state) return null;

  const monthRuns = await db.select({
    id: payrollRuns.id,
    status: payrollRuns.status,
    periodEnd: payrollRuns.periodEnd,
  }).from(payrollRuns).where(and(
    eq(payrollRuns.organizationId, organizationId),
    gte(payrollRuns.periodEnd, monthStart(applicableMonth)),
    lte(payrollRuns.periodEnd, monthEnd(applicableMonth)),
  ));

  const runIds = monthRuns.map((run) => run.id);
  const entries = runIds.length
    ? await db.select({
        payrollRunId: payrollEntries.payrollRunId,
        employeeId: payrollEntries.employeeId,
        lineItems: payrollEntries.lineItems,
        trace: payrollEntries.trace,
      }).from(payrollEntries).where(inArray(payrollEntries.payrollRunId, runIds))
    : [];
  const runMonths = Object.fromEntries(
    monthRuns.map((run) => [run.id, applicableMonth]),
  ) as Record<number, string>;
  const requiredAgencies = [...statutoryLiabilityKeys({ runMonths, entries })]
    .map((key) => key.split("|")[1])
    .filter(Boolean)
    .sort();

  const monthBatchIds = state.batches
    .filter((batch) => batch.applicableMonth === applicableMonth)
    .map((batch) => batch.id);
  const corrections = monthBatchIds.length
    ? await db.select().from(statutoryRemittanceCorrectionRequests).where(and(
        eq(statutoryRemittanceCorrectionRequests.organizationId, organizationId),
        inArray(statutoryRemittanceCorrectionRequests.batchId, monthBatchIds),
        eq(statutoryRemittanceCorrectionRequests.status, "approved"),
      ))
    : [];

  const issueCases = await db.select().from(statutoryContributionIssueCases).where(and(
    eq(statutoryContributionIssueCases.organizationId, organizationId),
    eq(statutoryContributionIssueCases.applicableMonth, applicableMonth),
  ));

  const evaluation = evaluateRemittanceMonthClose({
    applicableMonth,
    batches: state.batches,
    members: state.members,
    alerts: state.alerts,
    corrections,
    issueCases,
    requiredAgencies,
    allPayrollRunsReleased:
      monthRuns.length > 0 && monthRuns.every((run) => run.status === "Released"),
  });

  const closures = await db.select().from(statutoryRemittanceMonthClosures)
    .where(and(
      eq(statutoryRemittanceMonthClosures.organizationId, organizationId),
      eq(statutoryRemittanceMonthClosures.applicableMonth, applicableMonth),
    ))
    .orderBy(desc(statutoryRemittanceMonthClosures.certifiedAt), desc(statutoryRemittanceMonthClosures.id));
  const closure = closures[0] ?? null;

  const certificationValid = Boolean(
    closure
    && closure.status === "certified"
    && closure.snapshotHash === evaluation.snapshotHash
    && evaluation.ready,
  );

  return {
    evaluation,
    closure,
    certificationHistory: closures,
    certificationValid,
  };
}

export function employeeCertificationStatus(input: {
  certificationValid: boolean;
  closure: { status: string; certifiedAt: Date | string; invalidatedAt?: Date | string | null } | null;
  evaluationReady: boolean;
}) {
  if (input.certificationValid && input.closure) {
    return {
      status: "certified" as const,
      label: "Certified",
      detail: "This month’s statutory remittance evidence passed independent certification.",
      certifiedAt: String(input.closure.certifiedAt),
      needsRecertification: false,
    };
  }

  if (input.closure) {
    return {
      status: "under_review" as const,
      label: "Under review",
      detail: input.evaluationReady
        ? "The evidence changed after an earlier certification and requires fresh independent certification."
        : "The statutory remittance evidence currently has an unresolved compliance blocker.",
      certifiedAt: null,
      needsRecertification: true,
    };
  }

  return {
    status: input.evaluationReady ? "ready_for_review" as const : "not_certified" as const,
    label: input.evaluationReady ? "Awaiting certification" : "Not yet certified",
    detail: input.evaluationReady
      ? "The remittance evidence is reconciled and awaiting independent certification."
      : "This month has not yet passed independent statutory remittance certification.",
    certifiedAt: null,
    needsRecertification: false,
  };
}
