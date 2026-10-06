import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents,
  governmentFilingValidations,
  payrollEntries,
  payrollMonthClosures,
  payrollRuns,
  statutoryContributionIssueCases,
  statutoryRemittanceCorrectionRequests,
  statutoryRemittanceMonthClosures,
} from "@/db/schema";
import { findFilingForm, provesOperationalFiling } from "@/lib/filing-evidence";
import { buildLaborInspectionReadiness } from "@/lib/labor-inspection-readiness-server";
import {
  evaluatePayrollMonthClose,
  type PayrollMonthRunEvidence,
} from "@/lib/payroll-month-close";
import { derivePayrollPayoutState } from "@/lib/payroll-payout-state";
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

function metadata(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function belongsToRun(event: typeof auditEvents.$inferSelect, runId: number) {
  return Number(metadata(event.metadata).runId) === runId;
}

async function liveRemittanceCertification(organizationId: number, legalEntityId: number, applicableMonth: string) {
  const state = await loadStatutoryRemittanceState(organizationId, legalEntityId);
  if (!state) {
    return {
      certificationValid: false,
      snapshotHash: null,
      certifiedByName: null,
      certifiedAt: null,
      blockerCount: 1,
      blockers: ["Organization statutory remittance state could not be loaded."],
    };
  }

  const monthRuns = await db.select({
    id: payrollRuns.id,
    status: payrollRuns.status,
    periodEnd: payrollRuns.periodEnd,
  }).from(payrollRuns).where(and(
    eq(payrollRuns.organizationId, organizationId),
    eq(payrollRuns.legalEntityId, legalEntityId),
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
    eq(statutoryContributionIssueCases.legalEntityId, legalEntityId),
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

  const [closure] = await db.select().from(statutoryRemittanceMonthClosures)
    .where(and(
      eq(statutoryRemittanceMonthClosures.organizationId, organizationId),
      eq(statutoryRemittanceMonthClosures.legalEntityId, legalEntityId),
      eq(statutoryRemittanceMonthClosures.applicableMonth, applicableMonth),
    ))
    .orderBy(desc(statutoryRemittanceMonthClosures.certifiedAt), desc(statutoryRemittanceMonthClosures.id))
    .limit(1);

  const certificationValid = Boolean(
    closure
    && closure.status === "certified"
    && closure.snapshotHash === evaluation.snapshotHash
    && evaluation.ready,
  );

  return {
    certificationValid,
    snapshotHash: evaluation.snapshotHash,
    certifiedByName: certificationValid ? closure?.certifiedByName ?? null : null,
    certifiedAt: certificationValid && closure ? closure.certifiedAt.toISOString() : null,
    blockerCount: evaluation.blockers.length,
    blockers: evaluation.blockers,
  };
}

export async function buildPayrollMonthCloseState(
  organizationId: number,
  legalEntityId: number,
  applicableMonth: string,
) {
  const payMonthRuns = await db.select().from(payrollRuns)
    .where(and(
      eq(payrollRuns.organizationId, organizationId),
      eq(payrollRuns.legalEntityId, legalEntityId),
      gte(payrollRuns.payDate, monthStart(applicableMonth)),
      lte(payrollRuns.payDate, monthEnd(applicableMonth)),
    ))
    .orderBy(asc(payrollRuns.payDate), asc(payrollRuns.id));

  const runIds = payMonthRuns.map((run) => run.id);
  const [events, filingRows, remittance, inspection] = await Promise.all([
    db.select().from(auditEvents)
      .where(eq(auditEvents.organizationId, organizationId))
      .orderBy(asc(auditEvents.createdAt), asc(auditEvents.id)),
    db.select().from(governmentFilingValidations)
      .where(and(
        eq(governmentFilingValidations.organizationId, organizationId),
        eq(governmentFilingValidations.legalEntityId, legalEntityId),
        eq(governmentFilingValidations.agency, "BIR"),
        eq(governmentFilingValidations.form, "1601-C"),
        eq(governmentFilingValidations.applicableMonth, applicableMonth),
      ))
      .orderBy(desc(governmentFilingValidations.submittedAt), desc(governmentFilingValidations.id)),
    liveRemittanceCertification(organizationId, legalEntityId, applicableMonth),
    buildLaborInspectionReadiness(organizationId),
  ]);

  const runEvidence: PayrollMonthRunEvidence[] = payMonthRuns.map((run) => {
    const runEvents = events.filter((event) => belongsToRun(event, run.id));
    const payout = derivePayrollPayoutState(
      events as Parameters<typeof derivePayrollPayoutState>[0],
      run.id,
    );
    const journal = [...runEvents].reverse().find((event) => event.action === "journal export generated") ?? null;
    const close = [...runEvents].reverse().find((event) => event.action === "Payroll close completed") ?? null;
    return {
      id: run.id,
      periodLabel: run.periodLabel,
      payDate: String(run.payDate),
      status: run.status,
      payoutCompleted: payout.payout.status === "completed",
      payoutReference: payout.payout.reference,
      journalExported: Boolean(journal),
      closeCompleted: Boolean(close),
      closeActor: close?.actor ?? null,
    };
  });

  const birDefinition = findFilingForm("BIR", "1601-C");
  const birProof = birDefinition
    ? filingRows.find((row) => provesOperationalFiling(row, birDefinition)) ?? null
    : null;

  const highInspectionFindings = inspection.findings.filter((finding) =>
    finding.severity === "high"
    && finding.payrollRunId != null
    && runIds.includes(finding.payrollRunId),
  );

  const evaluation = evaluatePayrollMonthClose({
    applicableMonth,
    runs: runEvidence,
    bir1601c: {
      proven: Boolean(birProof),
      agencyReference: birProof?.agencyReference ?? null,
      submittedAt: birProof?.submittedAt?.toISOString() ?? null,
      recordedBy: birProof?.recordedBy ?? null,
      generatorVersion: birProof?.generatorVersion ?? null,
    },
    remittance: {
      certificationValid: remittance.certificationValid,
      snapshotHash: remittance.snapshotHash,
      certifiedByName: remittance.certifiedByName,
      certifiedAt: remittance.certifiedAt,
      blockerCount: remittance.blockerCount,
    },
    inspection: {
      highFindingCount: highInspectionFindings.length,
      findingKeys: highInspectionFindings.map((finding) => finding.key),
      recordedExposure: highInspectionFindings.reduce(
        (sum, finding) => sum + (finding.exposureConfidence === "recorded-liability" ? finding.exposureAmount ?? 0 : 0),
        0,
      ),
      screeningExposure: highInspectionFindings.reduce(
        (sum, finding) => sum + (finding.exposureConfidence === "screening-estimate" ? finding.exposureAmount ?? 0 : 0),
        0,
      ),
    },
  });

  const closures = await db.select().from(payrollMonthClosures)
    .where(and(
      eq(payrollMonthClosures.organizationId, organizationId),
      eq(payrollMonthClosures.legalEntityId, legalEntityId),
      eq(payrollMonthClosures.applicableMonth, applicableMonth),
    ))
    .orderBy(desc(payrollMonthClosures.certifiedAt), desc(payrollMonthClosures.id));

  const closure = closures[0] ?? null;
  const certificationValid = Boolean(
    closure
    && closure.status === "certified"
    && closure.snapshotHash === evaluation.snapshotHash
    && evaluation.ready,
  );

  const evidenceActors = new Set<string>();
  for (const run of payMonthRuns) {
    const runEvents = events.filter((event) => belongsToRun(event, run.id));
    for (const event of runEvents) {
      if (
        event.action === "Payroll close completed"
        || event.action === "journal export generated"
        || event.action === "Payroll payout completed manually"
        || event.action === "Payroll payout completed via PayMongo"
      ) evidenceActors.add(event.actor);
    }
  }
  if (birProof?.recordedBy) evidenceActors.add(birProof.recordedBy);
  if (remittance.certifiedByName) evidenceActors.add(remittance.certifiedByName);

  return {
    legalEntityId,
    applicableMonth,
    evaluation,
    closure,
    certificationHistory: closures,
    certificationValid,
    evidenceActors: [...evidenceActors].sort(),
    runEvidence,
    bir1601c: evaluation.evidence.bir1601c,
    remittance: {
      ...evaluation.evidence.remittance,
      blockers: remittance.blockers,
    },
    inspection: evaluation.evidence.inspection,
  };
}
