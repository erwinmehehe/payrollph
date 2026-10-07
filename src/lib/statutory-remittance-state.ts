import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  governmentFilingValidations,
  legalEntities,
  organizations,
  payrollEntries,
  payrollRuns,
  statutoryRemittanceBatches,
  statutoryRemittanceMembers,
  statutoryRemittancePaymentEvidence,
  statutoryPostingEvidenceArtifacts,
} from "@/db/schema";
import { buildStatutoryRemittanceAlerts } from "@/lib/statutory-remittance-alerts";
import { FILING_FORMS } from "@/lib/filing-evidence";
import { compareFilingToRemittance } from "@/lib/filing-remittance-snapshot";
import { postingEvidenceSourceLabel } from "@/lib/statutory-posting-evidence";
import {
  effectiveRemittanceDueDate,
  statutorySharesForEntry,
  type StatutoryAgency,
} from "@/lib/statutory-remittance";

export function currentManilaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function currentManilaMonth() {
  return currentManilaDate().slice(0, 7);
}

export function statutoryLiabilityKeys(input: {
  runMonths: Record<number, string>;
  entries: Array<{
    payrollRunId: number;
    employeeId: number;
    lineItems: unknown;
    trace: unknown;
  }>;
}) {
  const keys = new Set<string>();
  const agencies: StatutoryAgency[] = ["SSS", "PhilHealth", "Pag-IBIG"];

  for (const entry of input.entries) {
    const applicableMonth = input.runMonths[entry.payrollRunId];
    if (!applicableMonth) continue;

    for (const agency of agencies) {
      const shares = statutorySharesForEntry(entry, agency);
      if (shares.employeeShare + shares.employerShare > 0) {
        keys.add(`${applicableMonth}|${agency}`);
      }
    }
  }

  return keys;
}

export async function loadStatutoryRemittanceState(organizationId: number, legalEntityId: number) {
  const [[organization], [legalEntity]] = await Promise.all([
    db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1),
    db.select().from(legalEntities).where(and(
      eq(legalEntities.id, legalEntityId),
      eq(legalEntities.organizationId, organizationId),
    )).limit(1),
  ]);
  if (!organization || !legalEntity) return null;

  const batches = await db.select().from(statutoryRemittanceBatches)
    .where(and(
      eq(statutoryRemittanceBatches.organizationId, organizationId),
      eq(statutoryRemittanceBatches.legalEntityId, legalEntityId),
    ))
    .orderBy(asc(statutoryRemittanceBatches.applicableMonth), asc(statutoryRemittanceBatches.agency));

  const batchIds = batches.map((batch) => batch.id);
  const members = batchIds.length
    ? await db.select().from(statutoryRemittanceMembers)
        .where(and(
          eq(statutoryRemittanceMembers.organizationId, organizationId),
          inArray(statutoryRemittanceMembers.batchId, batchIds),
        ))
        .orderBy(asc(statutoryRemittanceMembers.batchId), asc(statutoryRemittanceMembers.employeeNo))
    : [];

  const evidenceArtifactIds = [...new Set(
    members
      .map((member) => member.postingEvidenceArtifactId)
      .filter((id): id is number => Number.isInteger(id)),
  )];
  const postingEvidenceRows = evidenceArtifactIds.length
    ? await db.select({
        id: statutoryPostingEvidenceArtifacts.id,
        batchId: statutoryPostingEvidenceArtifacts.batchId,
        sourceType: statutoryPostingEvidenceArtifacts.sourceType,
        outcome: statutoryPostingEvidenceArtifacts.outcome,
        fileName: statutoryPostingEvidenceArtifacts.fileName,
        byteSize: statutoryPostingEvidenceArtifacts.byteSize,
        contentSha256: statutoryPostingEvidenceArtifacts.contentSha256,
        rowCount: statutoryPostingEvidenceArtifacts.rowCount,
        recordedByName: statutoryPostingEvidenceArtifacts.recordedByName,
        createdAt: statutoryPostingEvidenceArtifacts.createdAt,
      }).from(statutoryPostingEvidenceArtifacts)
        .where(and(
          eq(statutoryPostingEvidenceArtifacts.organizationId, organizationId),
          inArray(statutoryPostingEvidenceArtifacts.id, evidenceArtifactIds),
        ))
    : [];
  const postingEvidenceById = new Map(postingEvidenceRows.map((row) => [row.id, row]));
  const membersWithEvidence = members.map((member) => {
    const artifact = member.postingEvidenceArtifactId
      ? postingEvidenceById.get(member.postingEvidenceArtifactId) ?? null
      : null;
    return {
      ...member,
      postingEvidenceSource: artifact ? postingEvidenceSourceLabel(artifact.sourceType) : null,
      postingEvidenceHashSha256: artifact?.contentSha256 ?? null,
      postingEvidenceFileName: artifact?.fileName ?? null,
      postingEvidenceByteSize: artifact?.byteSize ?? null,
      postingEvidenceRowCount: artifact?.rowCount ?? null,
      postingEvidenceRecordedBy: artifact?.recordedByName ?? null,
      postingEvidenceRecordedAt: artifact?.createdAt ?? null,
    };
  });

  const paymentProofRows = batchIds.length
    ? await db.select({
        batchId: statutoryRemittancePaymentEvidence.batchId,
        status: statutoryRemittancePaymentEvidence.status,
        fileSha256: statutoryRemittancePaymentEvidence.fileSha256,
      }).from(statutoryRemittancePaymentEvidence)
        .where(and(
          eq(statutoryRemittancePaymentEvidence.organizationId, organizationId),
          inArray(statutoryRemittancePaymentEvidence.batchId, batchIds),
        ))
    : [];
  const activePaymentProofBatchIds = new Set(
    paymentProofRows
      .filter((row) => row.status === "active" && Boolean(row.fileSha256))
      .map((row) => row.batchId),
  );

  const filingRows = await db.select().from(governmentFilingValidations)
    .where(and(
      eq(governmentFilingValidations.organizationId, organizationId),
      eq(governmentFilingValidations.legalEntityId, legalEntityId),
    ))
    .orderBy(asc(governmentFilingValidations.id));

  const releasedRuns = await db.select({
    id: payrollRuns.id,
    periodEnd: payrollRuns.periodEnd,
  }).from(payrollRuns).where(and(
    eq(payrollRuns.organizationId, organizationId),
    eq(payrollRuns.legalEntityId, legalEntityId),
    eq(payrollRuns.status, "Released"),
  ));

  const today = currentManilaDate();
  const closedMonths = [...new Set(
    releasedRuns
      .map((run) => String(run.periodEnd).slice(0, 7))
      .filter((month) => month < currentManilaMonth()),
  )].sort().slice(-6);
  const closedMonthSet = new Set(closedMonths);
  const closedRuns = releasedRuns.filter((run) =>
    closedMonthSet.has(String(run.periodEnd).slice(0, 7)),
  );
  const closedRunIds = closedRuns.map((run) => run.id);
  const releasedEntries = closedRunIds.length
    ? await db.select({
        payrollRunId: payrollEntries.payrollRunId,
        employeeId: payrollEntries.employeeId,
        lineItems: payrollEntries.lineItems,
        trace: payrollEntries.trace,
      }).from(payrollEntries).where(inArray(payrollEntries.payrollRunId, closedRunIds))
    : [];
  const runMonths = Object.fromEntries(
    closedRuns.map((run) => [run.id, String(run.periodEnd).slice(0, 7)]),
  ) as Record<number, string>;
  const liabilityKeys = statutoryLiabilityKeys({
    runMonths,
    entries: releasedEntries,
  });

  const existingKeys = new Set(
    batches.map((batch) => `${batch.applicableMonth}|${batch.agency}`),
  );

  const coverageGaps = closedMonths.flatMap((applicableMonth) =>
    (["SSS", "PhilHealth", "Pag-IBIG"] as const)
      .filter((agency) =>
        liabilityKeys.has(`${applicableMonth}|${agency}`)
        && !existingKeys.has(`${applicableMonth}|${agency}`),
      )
      .map((agency) => {
        let dueDate: string | null = null;
        try {
          dueDate = effectiveRemittanceDueDate({
            agency,
            applicableMonth,
            legalName: legalEntity.legalName,
            philHealthEmployerNo: legalEntity.philHealthEmployerNo,
          });
        } catch {
          dueDate = null;
        }
        return { applicableMonth, agency, dueDate };
      }),
  );

  const batchSummaries = batches.map((batch) => {
    const definition = FILING_FORMS.find((item) =>
      item.agency === batch.agency
      && ((batch.agency === "SSS" && item.form === "R-3")
        || (batch.agency === "PhilHealth" && item.form === "RF-1")
        || (batch.agency === "Pag-IBIG" && item.form === "MCRF")),
    );
    const filing = definition
      ? [...filingRows]
          .filter((row) =>
            row.agency === batch.agency
            && row.form === definition.form
            && row.applicableMonth === batch.applicableMonth
            && row.status === "accepted"
            && row.submissionMethod === "file_upload"
            && row.generatorVersion === definition.generatorVersion
            && row.employeeCount != null
            && row.reportedTotal != null,
          )
          .sort((a, b) =>
            (b.submittedAt?.getTime() ?? 0) - (a.submittedAt?.getTime() ?? 0)
            || b.id - a.id,
          )[0] ?? null
      : null;

    const comparison = filing
      ? compareFilingToRemittance({
          filingEmployeeCount: filing.employeeCount!,
          filingTotal: Number(filing.reportedTotal),
          remittanceEmployeeCount: batch.employeeCount,
          remittanceTotal: Number(batch.expectedTotal),
        })
      : null;

    return {
      ...batch,
      displayStatus:
        batch.status === "open" && String(batch.dueDate) < today
          ? "overdue"
          : batch.status,
      pendingPostingCount: membersWithEvidence.filter(
        (member) => member.batchId === batch.id && member.postingStatus === "pending",
      ).length,
      exceptionCount: membersWithEvidence.filter(
        (member) => member.batchId === batch.id && member.postingStatus === "exception",
      ).length,
      paymentShortfall: Math.max(
        0,
        Number(batch.expectedTotal) - Number(batch.amountPaid ?? 0),
      ),
      hasActivePaymentProof: activePaymentProofBatchIds.has(batch.id),
      filingCheck: filing && comparison
        ? {
            status: comparison.matched ? "matched" as const : "mismatch" as const,
            filingRecordId: filing.id,
            filingEmployeeCount: filing.employeeCount,
            remittanceEmployeeCount: batch.employeeCount,
            filingTotal: Number(filing.reportedTotal),
            remittanceTotal: Number(batch.expectedTotal),
            employeeCountDifference: comparison.employeeCountDifference,
            totalDifference: comparison.totalDifference,
          }
        : {
            status: "unverified" as const,
            filingRecordId: null,
            filingEmployeeCount: null,
            remittanceEmployeeCount: batch.employeeCount,
            filingTotal: null,
            remittanceTotal: Number(batch.expectedTotal),
            employeeCountDifference: null,
            totalDifference: null,
          },
    };
  });

  const alerts = buildStatutoryRemittanceAlerts({
    today,
    batches: batchSummaries,
    coverageGaps,
  });

  return {
    organization,
    legalEntity,
    today,
    batches: batchSummaries,
    members: membersWithEvidence,
    coverageGaps,
    alerts,
  };
}
