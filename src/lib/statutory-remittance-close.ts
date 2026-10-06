import { createHash } from "node:crypto";

type Batch = {
  id: number;
  agency: string;
  applicableMonth: string;
  status: string;
  snapshotHash: string;
  reconciledAt: Date | string | null;
  paymentRecordedBy?: string | null;
  reconciledBy?: string | null;
  pendingPostingCount: number;
  exceptionCount: number;
};

type Member = {
  batchId: number;
  employeeId: number;
  postingStatus: string;
  postedAmount?: string | null;
  postingReference?: string | null;
  confirmedBy?: string | null;
  postingEvidenceArtifactId?: number | null;
  postingEvidenceSource?: string | null;
  postingEvidenceHashSha256?: string | null;
};

type PaymentEvidence = {
  id: number;
  batchId: number;
  fileName: string;
  fileSha256: string;
  byteSize: number;
  status: string;
  uploadedByName: string;
  uploadedAt: Date | string;
};

type Correction = {
  id: number;
  batchId: number;
  memberId: number | null;
  status: string;
  decidedByName: string | null;
  appliedAt: Date | string | null;
};

type Alert = {
  agency: string;
  applicableMonth: string;
  title: string;
  tone: string;
};

type ContributionIssueCase = {
  id: number;
  employeeId: number;
  agency: string;
  applicableMonth: string;
  issueType: string;
  status: string;
  reportedByName: string;
  assignedToName?: string | null;
  resolutionOutcome?: string | null;
  resolutionNote?: string | null;
  resolvedByName?: string | null;
  createdAt: Date | string;
  resolvedAt?: Date | string | null;
};

export function evaluateRemittanceMonthClose(input: {
  applicableMonth: string;
  batches: Batch[];
  members: Member[];
  alerts: Alert[];
  corrections?: Correction[];
  paymentEvidence?: PaymentEvidence[];
  issueCases?: ContributionIssueCase[];
  requiredAgencies: string[];
  allPayrollRunsReleased: boolean;
}) {
  const monthBatches = input.batches
    .filter((batch) => batch.applicableMonth === input.applicableMonth)
    .sort((a, b) => a.agency.localeCompare(b.agency));
  const monthAlerts = input.alerts.filter(
    (alert) => alert.applicableMonth === input.applicableMonth,
  );

  const blockers: string[] = [];
  if (!input.allPayrollRunsReleased) {
    blockers.push("Every payroll run in the month must be Released before remittance close.");
  }
  if (input.requiredAgencies.length === 0) {
    blockers.push("No released statutory contribution liability was found for this month.");
  }
  for (const agency of input.requiredAgencies) {
    if (!monthBatches.some((batch) => batch.agency === agency)) {
      blockers.push(`${agency} remittance batch is missing for this month.`);
    }
  }
  if (monthBatches.length === 0) blockers.push("No remittance batches exist for this month.");
  for (const alert of monthAlerts) blockers.push(alert.title);
  const activePaymentEvidence = (input.paymentEvidence ?? [])
    .filter((evidence) => evidence.status === "active");
  for (const batch of monthBatches) {
    if (!activePaymentEvidence.some((evidence) => evidence.batchId === batch.id)) {
      blockers.push(`${batch.agency} has no active hashed payment proof artifact.`);
    }
    if (batch.status !== "reconciled") {
      blockers.push(`${batch.agency} is ${batch.status}, not reconciled.`);
    }
    if (batch.pendingPostingCount > 0) {
      blockers.push(`${batch.agency} has ${batch.pendingPostingCount} employee posting confirmation(s) outstanding.`);
    }
    if (batch.exceptionCount > 0) {
      blockers.push(`${batch.agency} has ${batch.exceptionCount} employee posting exception(s).`);
    }
  }

  const issueCases = (input.issueCases ?? [])
    .filter((issue) => issue.applicableMonth === input.applicableMonth)
    .sort((a, b) => a.id - b.id);
  const unresolvedIssueCases = issueCases.filter((issue) => issue.status !== "resolved");
  if (unresolvedIssueCases.length > 0) {
    blockers.push(
      `${unresolvedIssueCases.length} employee contribution issue case(s) remain unresolved for this month.`,
    );
  }

  const monthBatchIds = new Set(monthBatches.map((batch) => batch.id));
  const members = input.members
    .filter((member) => monthBatchIds.has(member.batchId))
    .sort((a, b) => a.batchId - b.batchId || a.employeeId - b.employeeId);

  const evidence = {
    applicableMonth: input.applicableMonth,
    batches: monthBatches.map((batch) => ({
      id: batch.id,
      agency: batch.agency,
      status: batch.status,
      snapshotHash: batch.snapshotHash,
      reconciledAt: batch.reconciledAt ? String(batch.reconciledAt) : null,
      paymentRecordedBy: batch.paymentRecordedBy ?? null,
      reconciledBy: batch.reconciledBy ?? null,
      pendingPostingCount: batch.pendingPostingCount,
      exceptionCount: batch.exceptionCount,
    })),
    paymentEvidence: activePaymentEvidence
      .filter((evidence) => monthBatchIds.has(evidence.batchId))
      .sort((a, b) => a.batchId - b.batchId || a.id - b.id)
      .map((evidence) => ({
        id: evidence.id,
        batchId: evidence.batchId,
        fileName: evidence.fileName,
        fileSha256: evidence.fileSha256,
        byteSize: evidence.byteSize,
        uploadedByName: evidence.uploadedByName,
        uploadedAt: String(evidence.uploadedAt),
      })),
    members: members.map((member) => ({
      batchId: member.batchId,
      employeeId: member.employeeId,
      postingStatus: member.postingStatus,
      postedAmount: member.postedAmount ?? null,
      postingReference: member.postingReference ?? null,
      confirmedBy: member.confirmedBy ?? null,
      ...(member.postingEvidenceArtifactId || member.postingEvidenceHashSha256
        ? {
            postingEvidenceArtifactId: member.postingEvidenceArtifactId ?? null,
            postingEvidenceSource: member.postingEvidenceSource ?? null,
            postingEvidenceHashSha256: member.postingEvidenceHashSha256 ?? null,
          }
        : {}),
    })),
    corrections: (input.corrections ?? [])
      .filter((correction) => monthBatchIds.has(correction.batchId) && correction.status === "approved" && correction.appliedAt)
      .sort((a, b) => a.id - b.id)
      .map((correction) => ({
        id: correction.id,
        batchId: correction.batchId,
        memberId: correction.memberId,
        decidedByName: correction.decidedByName,
        appliedAt: correction.appliedAt ? String(correction.appliedAt) : null,
      })),
    issueCases: issueCases.map((issue) => ({
      id: issue.id,
      employeeId: issue.employeeId,
      agency: issue.agency,
      issueType: issue.issueType,
      status: issue.status,
      reportedByName: issue.reportedByName,
      assignedToName: issue.assignedToName ?? null,
      resolutionOutcome: issue.resolutionOutcome ?? null,
      resolutionNote: issue.resolutionNote ?? null,
      resolvedByName: issue.resolvedByName ?? null,
      createdAt: String(issue.createdAt),
      resolvedAt: issue.resolvedAt ? String(issue.resolvedAt) : null,
    })),
  };

  const snapshotHash = createHash("sha256")
    .update(JSON.stringify(evidence))
    .digest("hex");

  return {
    ready: blockers.length === 0,
    blockers: [...new Set(blockers)],
    snapshotHash,
    agencyCount: monthBatches.length,
    memberCount: members.length,
    batches: evidence.batches,
    members: evidence.members,
    paymentEvidence: evidence.paymentEvidence,
    corrections: evidence.corrections,
    issueCases: evidence.issueCases,
  };
}
