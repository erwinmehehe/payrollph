import { createHash } from "node:crypto";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { DEFAULT_HCM_LIFECYCLE_POLICY } from "@/lib/hcm-lifecycle-policy";
import { probationReviewSnapshot } from "@/lib/hcm-probation-reviews";
import {
  auditEvents,
  documents,
  employees,
  hcmEmploymentDecisionDocuments,
  hcmEmploymentDecisionEvents,
  hcmEmploymentDecisionManagerAttestations,
  hcmEmploymentDecisionNotes,
  hcmEmploymentTermDecisions,
  hcmEmploymentTerms,
  hcmLifecyclePolicies,
  hcmProbationReviewAcknowledgments,
  hcmProbationReviews,
  positionAssignments,
  positions,
} from "@/db/schema";

export const EMPLOYMENT_DECISION_NOTE_KINDS = [
  "manager_review",
  "hr_review",
  "decision_rationale",
  "other",
] as const;

export const EMPLOYMENT_DECISION_EVIDENCE_KINDS = [
  "probation_evaluation",
  "performance_review",
  "contract",
  "manager_recommendation",
  "other",
] as const;

export type EmploymentDecisionNoteKind = (typeof EMPLOYMENT_DECISION_NOTE_KINDS)[number];
export type EmploymentDecisionEvidenceKind = (typeof EMPLOYMENT_DECISION_EVIDENCE_KINDS)[number];

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  const row = value as Record<string, unknown>;
  return Object.keys(row).sort().reduce<Record<string, unknown>>((out, key) => {
    out[key] = canonicalize(row[key]);
    return out;
  }, {});
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

export function evidenceSha256(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function proposalSnapshotV1(
  decision: typeof hcmEmploymentTermDecisions.$inferSelect,
  term: typeof hcmEmploymentTerms.$inferSelect,
  notes: Array<typeof hcmEmploymentDecisionNotes.$inferSelect>,
  attachments: Array<{
    evidence: typeof hcmEmploymentDecisionDocuments.$inferSelect;
    document: Pick<
      typeof documents.$inferSelect,
      "id" | "fileName" | "mimeType" | "byteSize" | "sha256" | "scannedClean" | "scanNote" | "createdAt"
    >;
  }>,
) {
  return {
    packetVersion: "hcm-employment-decision-evidence-v1",
    decision: {
      id: decision.id,
      organizationId: decision.organizationId,
      employeeId: decision.employeeId,
      employmentTermId: decision.employmentTermId,
      decisionKind: decision.decisionKind,
      effectiveDate: String(decision.effectiveDate),
      nextEmploymentType: decision.nextEmploymentType,
      nextTermKind: decision.nextTermKind,
      nextEffectiveUntil: decision.nextEffectiveUntil ? String(decision.nextEffectiveUntil) : null,
      nextProbationReviewDate: decision.nextProbationReviewDate ? String(decision.nextProbationReviewDate) : null,
      nextContractEndDate: decision.nextContractEndDate ? String(decision.nextContractEndDate) : null,
      nextProjectName: decision.nextProjectName,
      proposedSeparationLastDay: decision.proposedSeparationLastDay
        ? String(decision.proposedSeparationLastDay)
        : null,
      separationReason: decision.separationReason,
      reason: decision.reason,
      requestedByUserId: decision.requestedByUserId,
      requestedBy: decision.requestedBy,
      requestedAt: decision.createdAt.toISOString(),
    },
    sourceEmploymentTerms: {
      id: term.id,
      employmentType: term.employmentType,
      termKind: term.termKind,
      effectiveFrom: String(term.effectiveFrom),
      effectiveUntil: term.effectiveUntil ? String(term.effectiveUntil) : null,
      probationReviewDate: term.probationReviewDate ? String(term.probationReviewDate) : null,
      contractEndDate: term.contractEndDate ? String(term.contractEndDate) : null,
      projectName: term.projectName,
      reason: term.reason,
    },
    notes: notes.map((note) => ({
      id: note.id,
      noteKind: note.noteKind,
      content: note.content,
      createdByUserId: note.createdByUserId,
      createdByName: note.createdByName,
      createdAt: note.createdAt.toISOString(),
    })),
    attachments: attachments.map(({ evidence, document }) => ({
      id: evidence.id,
      documentId: document.id,
      evidenceKind: evidence.evidenceKind,
      label: evidence.label,
      fileName: document.fileName,
      mimeType: document.mimeType,
      byteSize: document.byteSize,
      sha256: document.sha256,
      scannedClean: document.scannedClean,
      scanNote: document.scanNote,
      attachedByUserId: evidence.attachedByUserId,
      attachedByName: evidence.attachedByName,
      attachedAt: evidence.createdAt.toISOString(),
      documentCreatedAt: document.createdAt.toISOString(),
    })),
  };
}

function proposalSnapshotV2(
  decision: typeof hcmEmploymentTermDecisions.$inferSelect,
  term: typeof hcmEmploymentTerms.$inferSelect,
  notes: Array<typeof hcmEmploymentDecisionNotes.$inferSelect>,
  attachments: Array<{
    evidence: typeof hcmEmploymentDecisionDocuments.$inferSelect;
    document: Pick<
      typeof documents.$inferSelect,
      "id" | "fileName" | "mimeType" | "byteSize" | "sha256" | "scannedClean" | "scanNote" | "createdAt"
    >;
  }>,
  managerAttestations: Array<typeof hcmEmploymentDecisionManagerAttestations.$inferSelect>,
) {
  const v1 = proposalSnapshotV1(decision, term, notes, attachments);
  return {
    ...v1,
    packetVersion: "hcm-employment-decision-evidence-v2",
    managerAttestations: managerAttestations.map((attestation) => ({
      id: attestation.id,
      managerEmployeeId: attestation.managerEmployeeId,
      managerUserId: attestation.managerUserId,
      managerName: attestation.managerName,
      recommendation: attestation.recommendation,
      statement: attestation.statement,
      workerPositionAssignmentId: attestation.workerPositionAssignmentId,
      workerPositionId: attestation.workerPositionId,
      reportingLineSnapshot: attestation.reportingLineSnapshot,
      createdAt: attestation.createdAt.toISOString(),
    })),
  };
}

function proposalSnapshotV3(
  decision: typeof hcmEmploymentTermDecisions.$inferSelect,
  term: typeof hcmEmploymentTerms.$inferSelect,
  notes: Array<typeof hcmEmploymentDecisionNotes.$inferSelect>,
  attachments: Array<{
    evidence: typeof hcmEmploymentDecisionDocuments.$inferSelect;
    document: Pick<
      typeof documents.$inferSelect,
      "id" | "fileName" | "mimeType" | "byteSize" | "sha256" | "scannedClean" | "scanNote" | "createdAt"
    >;
  }>,
  managerAttestations: Array<typeof hcmEmploymentDecisionManagerAttestations.$inferSelect>,
  probationReview: typeof hcmProbationReviews.$inferSelect | null,
) {
  const v2 = proposalSnapshotV2(decision, term, notes, attachments, managerAttestations);
  return {
    ...v2,
    packetVersion: "hcm-employment-decision-evidence-v3",
    probationReview: probationReview ? probationReviewSnapshot(probationReview) : null,
  };
}

async function loadReviewEvidence(input: {
  organizationId: number;
  decisionId: number;
}) {
  const [decision] = await db.select().from(hcmEmploymentTermDecisions).where(and(
    eq(hcmEmploymentTermDecisions.id, input.decisionId),
    eq(hcmEmploymentTermDecisions.organizationId, input.organizationId),
  )).limit(1);
  if (!decision) return null;

  const [term, employee, notes, attachments, managerAttestations, structuredProbationReview] = await Promise.all([
    db.select().from(hcmEmploymentTerms).where(and(
      eq(hcmEmploymentTerms.id, decision.employmentTermId),
      eq(hcmEmploymentTerms.organizationId, decision.organizationId),
      eq(hcmEmploymentTerms.employeeId, decision.employeeId),
    )).limit(1).then((rows) => rows[0] ?? null),
    db.select({
      id: employees.id,
      employeeNo: employees.employeeNo,
      firstName: employees.firstName,
      lastName: employees.lastName,
      title: employees.title,
      employmentType: employees.employmentType,
      status: employees.status,
    }).from(employees).where(and(
      eq(employees.id, decision.employeeId),
      eq(employees.organizationId, decision.organizationId),
    )).limit(1).then((rows) => rows[0] ?? null),
    db.select().from(hcmEmploymentDecisionNotes).where(and(
      eq(hcmEmploymentDecisionNotes.organizationId, input.organizationId),
      eq(hcmEmploymentDecisionNotes.decisionId, input.decisionId),
    )).orderBy(asc(hcmEmploymentDecisionNotes.id)),
    db.select({
      evidence: hcmEmploymentDecisionDocuments,
      document: {
        id: documents.id,
        fileName: documents.fileName,
        mimeType: documents.mimeType,
        byteSize: documents.byteSize,
        sha256: documents.sha256,
        scannedClean: documents.scannedClean,
        scanNote: documents.scanNote,
        createdAt: documents.createdAt,
      },
    }).from(hcmEmploymentDecisionDocuments)
      .innerJoin(documents, eq(hcmEmploymentDecisionDocuments.documentId, documents.id))
      .where(and(
        eq(hcmEmploymentDecisionDocuments.organizationId, input.organizationId),
        eq(hcmEmploymentDecisionDocuments.decisionId, input.decisionId),
      ))
      .orderBy(asc(hcmEmploymentDecisionDocuments.id)),
    db.select().from(hcmEmploymentDecisionManagerAttestations).where(and(
      eq(hcmEmploymentDecisionManagerAttestations.organizationId, input.organizationId),
      eq(hcmEmploymentDecisionManagerAttestations.decisionId, input.decisionId),
    )).orderBy(
      asc(hcmEmploymentDecisionManagerAttestations.createdAt),
      asc(hcmEmploymentDecisionManagerAttestations.id),
    ),
    db.select().from(hcmProbationReviews).where(and(
      eq(hcmProbationReviews.organizationId, input.organizationId),
      eq(hcmProbationReviews.employmentTermId, decision.employmentTermId),
      eq(hcmProbationReviews.status, "submitted"),
    )).limit(1).then((rows) => rows[0] ?? null),
  ]);

  if (!term || !employee) return null;
  const evidencePacketVersion = decision.evidencePacketVersion === "v1"
    ? "v1"
    : decision.evidencePacketVersion === "v2"
      ? "v2"
      : "v3";
  const reviewEvidence = evidencePacketVersion === "v1"
    ? proposalSnapshotV1(decision, term, notes, attachments)
    : evidencePacketVersion === "v2"
      ? proposalSnapshotV2(decision, term, notes, attachments, managerAttestations)
      : proposalSnapshotV3(decision, term, notes, attachments, managerAttestations, structuredProbationReview);
  return {
    decision,
    employee,
    term,
    notes,
    attachments,
    managerAttestations,
    structuredProbationReview,
    evidencePacketVersion,
    reviewEvidence,
    currentEvidenceSha256: evidenceSha256(reviewEvidence),
  };
}

export async function loadEmploymentDecisionEvidencePacket(input: {
  organizationId: number;
  decisionId: number;
}) {
  const review = await loadReviewEvidence(input);
  if (!review) return null;

  const events = await db.select().from(hcmEmploymentDecisionEvents).where(and(
    eq(hcmEmploymentDecisionEvents.organizationId, input.organizationId),
    eq(hcmEmploymentDecisionEvents.decisionId, input.decisionId),
  )).orderBy(asc(hcmEmploymentDecisionEvents.createdAt), asc(hcmEmploymentDecisionEvents.id));

  const [probationReviewAcknowledgment] = review.structuredProbationReview
    ? await db.select().from(hcmProbationReviewAcknowledgments).where(
        eq(hcmProbationReviewAcknowledgments.reviewId, review.structuredProbationReview.id),
      ).limit(1)
    : [null];

  const sealedHash = review.decision.evidenceSnapshotSha256;
  return {
    packetVersion: review.evidencePacketVersion === "v1"
      ? "hcm-employment-decision-packet-v1"
      : review.evidencePacketVersion === "v2"
        ? "hcm-employment-decision-packet-v2"
        : "hcm-employment-decision-packet-v3",
    generatedAt: new Date().toISOString(),
    employee: review.employee,
    decision: review.decision,
    sourceEmploymentTerms: review.term,
    reviewEvidence: review.reviewEvidence,
    probationReviewAcknowledgment: probationReviewAcknowledgment ?? null,
    integrity: {
      sealed: Boolean(sealedHash),
      sealedAt: review.decision.evidenceSealedAt?.toISOString() ?? null,
      sealedSha256: sealedHash,
      currentSha256: review.currentEvidenceSha256,
      status: sealedHash
        ? sealedHash === review.currentEvidenceSha256 ? "verified" : "mismatch"
        : "unsealed",
    },
    timeline: events,
  };
}

export async function recordEmploymentDecisionEvidenceEvent(input: {
  organizationId: number;
  decisionId: number;
  employeeId: number;
  eventType: string;
  actor: string;
  actorUserId?: number | null;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
}) {
  const [event] = await db.insert(hcmEmploymentDecisionEvents).values({
    organizationId: input.organizationId,
    decisionId: input.decisionId,
    employeeId: input.employeeId,
    eventType: input.eventType.slice(0, 40),
    actorUserId: input.actorUserId ?? null,
    actorName: input.actor.slice(0, 120),
    metadata: input.metadata ?? {},
    createdAt: input.createdAt ?? new Date(),
  }).returning();
  return event;
}

export class DecisionEvidenceApprovalError extends Error {
  status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.name = "DecisionEvidenceApprovalError";
    this.status = status;
  }
}

export async function approveEmploymentDecisionWithEvidence(input: {
  organizationId: number;
  decisionId: number;
  approverUserId: number;
  approverName: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    await tx.execute(sql`
      select id
      from hcm_employment_term_decisions
      where id = ${input.decisionId}
        and organization_id = ${input.organizationId}
      for update
    `);

    const [decision] = await tx.select().from(hcmEmploymentTermDecisions).where(and(
      eq(hcmEmploymentTermDecisions.id, input.decisionId),
      eq(hcmEmploymentTermDecisions.organizationId, input.organizationId),
    )).limit(1);
    if (!decision) throw new DecisionEvidenceApprovalError("Employment-term decision not found.", 404);
    if (decision.status !== "pending_approval") {
      throw new DecisionEvidenceApprovalError("Only pending employment-term decisions can be approved.");
    }
    if (decision.requestedByUserId == null) {
      throw new DecisionEvidenceApprovalError(
        "Legacy employment-term decision has no accountable requester identity. Request a fresh reviewed decision.",
        409,
      );
    }
    if (decision.requestedByUserId === input.approverUserId) {
      throw new DecisionEvidenceApprovalError(
        "Four-eyes control: the requester cannot approve their own employment-term decision.",
        403,
      );
    }

    const [term] = await tx.select().from(hcmEmploymentTerms).where(and(
      eq(hcmEmploymentTerms.id, decision.employmentTermId),
      eq(hcmEmploymentTerms.organizationId, decision.organizationId),
      eq(hcmEmploymentTerms.employeeId, decision.employeeId),
    )).limit(1);
    if (!term || term.status !== "active") {
      throw new DecisionEvidenceApprovalError("The original active employment terms changed; create a new review against current terms.");
    }
    await tx.execute(sql`select id from employees
      where id = ${decision.employeeId} and organization_id = ${input.organizationId} for update`);
    const [worker] = await tx.select({
      id: employees.id, status: employees.status,
    }).from(employees).where(and(
      eq(employees.id, decision.employeeId),
      eq(employees.organizationId, input.organizationId),
    )).limit(1);
    if (!worker || !["Active", "On leave"].includes(worker.status)) {
      throw new DecisionEvidenceApprovalError("The worker changed lifecycle state; an employment-term decision cannot be approved while separating or inactive.");
    }

    const notes = await tx.select().from(hcmEmploymentDecisionNotes).where(and(
      eq(hcmEmploymentDecisionNotes.organizationId, input.organizationId),
      eq(hcmEmploymentDecisionNotes.decisionId, input.decisionId),
    )).orderBy(asc(hcmEmploymentDecisionNotes.id));

    const attachments = await tx.select({
      evidence: hcmEmploymentDecisionDocuments,
      document: {
        id: documents.id,
        fileName: documents.fileName,
        mimeType: documents.mimeType,
        byteSize: documents.byteSize,
        sha256: documents.sha256,
        scannedClean: documents.scannedClean,
        scanNote: documents.scanNote,
        createdAt: documents.createdAt,
      },
    }).from(hcmEmploymentDecisionDocuments)
      .innerJoin(documents, eq(hcmEmploymentDecisionDocuments.documentId, documents.id))
      .where(and(
        eq(hcmEmploymentDecisionDocuments.organizationId, input.organizationId),
        eq(hcmEmploymentDecisionDocuments.decisionId, input.decisionId),
      ))
      .orderBy(asc(hcmEmploymentDecisionDocuments.id));

    const managerAttestations = await tx.select()
      .from(hcmEmploymentDecisionManagerAttestations)
      .where(and(
        eq(hcmEmploymentDecisionManagerAttestations.organizationId, input.organizationId),
        eq(hcmEmploymentDecisionManagerAttestations.decisionId, input.decisionId),
      ))
      .orderBy(
        asc(hcmEmploymentDecisionManagerAttestations.createdAt),
        asc(hcmEmploymentDecisionManagerAttestations.id),
      );

    const [structuredProbationReview] = term.termKind === "probationary"
      ? await tx.select().from(hcmProbationReviews).where(and(
          eq(hcmProbationReviews.organizationId, input.organizationId),
          eq(hcmProbationReviews.employmentTermId, decision.employmentTermId),
          eq(hcmProbationReviews.status, "submitted"),
        )).limit(1)
      : [null];

    const [currentReportingLine] = await tx.select({
      assignmentId: positionAssignments.id,
      positionId: positions.id,
      managerEmployeeId: positions.managerEmployeeId,
    }).from(positionAssignments)
      .innerJoin(positions, eq(positionAssignments.positionId, positions.id))
      .where(and(
        eq(positionAssignments.organizationId, input.organizationId),
        eq(positionAssignments.employeeId, decision.employeeId),
        eq(positionAssignments.assignmentType, "primary"),
        isNull(positionAssignments.effectiveUntil),
      ))
      .orderBy(desc(positionAssignments.effectiveFrom), desc(positionAssignments.id))
      .limit(1);

    const currentManagerAttestation = currentReportingLine?.managerEmployeeId
      ? [...managerAttestations].reverse().find(
          (attestation) => attestation.managerEmployeeId === currentReportingLine.managerEmployeeId,
        ) ?? null
      : null;

    const [lifecyclePolicy] = await tx.select().from(hcmLifecyclePolicies)
      .where(eq(hcmLifecyclePolicies.organizationId, input.organizationId))
      .limit(1);
    const policy = lifecyclePolicy ?? DEFAULT_HCM_LIFECYCLE_POLICY;

    if (policy.requireManagerReviewForProbation && term.termKind === "probationary") {
      if (!currentReportingLine?.managerEmployeeId) {
        throw new DecisionEvidenceApprovalError(
          "Organization lifecycle policy requires a manager attestation, but this worker has no current manager on the active primary position.",
        );
      }
      if (!currentManagerAttestation) {
        throw new DecisionEvidenceApprovalError(
          "Organization lifecycle policy requires an attestation from the worker's current manager before approving a probation decision.",
        );
      }
    }
    if (
      policy.requireDecisionRationaleNote
      && !notes.some((note) => note.noteKind === "decision_rationale")
    ) {
      throw new DecisionEvidenceApprovalError(
        "Organization lifecycle policy requires a decision-rationale note before approval.",
      );
    }
    if (
      policy.requireNonRenewalAttachment
      && decision.decisionKind === "non_renew"
      && attachments.length === 0
    ) {
      throw new DecisionEvidenceApprovalError(
        "Organization lifecycle policy requires at least one evidence attachment before approving a non-renewal.",
      );
    }

    if (attachments.some(({ document }) => !document.scannedClean) && process.env.NODE_ENV === "production") {
      throw new DecisionEvidenceApprovalError(
        "All attached decision evidence must pass malware scanning before approval.",
      );
    }

    const reviewEvidence = proposalSnapshotV3(
      decision,
      term,
      notes,
      attachments,
      managerAttestations,
      structuredProbationReview ?? null,
    );
    const snapshotSha256 = evidenceSha256(reviewEvidence);

    const [scheduled] = await tx.update(hcmEmploymentTermDecisions).set({
      status: "scheduled",
      approvedByUserId: input.approverUserId,
      approvedBy: input.approverName,
      approvedAt: now,
      evidenceSnapshotSha256: snapshotSha256,
      evidencePacketVersion: "v3",
      evidenceSealedAt: now,
      failure: null,
      updatedAt: now,
    }).where(and(
      eq(hcmEmploymentTermDecisions.id, input.decisionId),
      eq(hcmEmploymentTermDecisions.status, "pending_approval"),
    )).returning();
    if (!scheduled) {
      throw new DecisionEvidenceApprovalError("Decision changed before approval.");
    }

    await tx.insert(hcmEmploymentDecisionEvents).values({
      organizationId: scheduled.organizationId,
      decisionId: scheduled.id,
      employeeId: scheduled.employeeId,
      eventType: "approved",
      actorUserId: input.approverUserId,
      actorName: input.approverName,
      metadata: {
        evidenceSnapshotSha256: snapshotSha256,
        noteCount: notes.length,
        attachmentCount: attachments.length,
        managerAttestationCount: managerAttestations.length,
        currentManagerAttestationId: currentManagerAttestation?.id ?? null,
        currentManagerRecommendation: currentManagerAttestation?.recommendation ?? null,
        structuredProbationReviewId: structuredProbationReview?.id ?? null,
        evidencePacketVersion: "v3",
        effectiveDate: String(scheduled.effectiveDate),
        decisionKind: scheduled.decisionKind,
        lifecyclePolicyVersion: lifecyclePolicy?.version ?? 0,
        lifecyclePolicyRequirements: {
          managerReviewForProbation: policy.requireManagerReviewForProbation,
          decisionRationaleNote: policy.requireDecisionRationaleNote,
          nonRenewalAttachment: policy.requireNonRenewalAttachment,
        },
      },
      createdAt: now,
    });

    // Approver action, sealed evidence and actor audit must all commit.
    // A missing audit row must roll back the approval and decision event.
    await tx.insert(auditEvents).values({
      organizationId: input.organizationId,
      actor: input.approverName,
      action: "HCM employment-term decision approved",
      resource: `Employee #${scheduled.employeeId}`,
      metadata: {
        employmentTermDecisionId: input.decisionId,
        effectiveDate: scheduled.effectiveDate,
        decisionKind: scheduled.decisionKind,
        evidenceSnapshotSha256: snapshotSha256,
        evidenceNoteCount: notes.length,
        evidenceAttachmentCount: attachments.length,
        reviewerUserId: input.approverUserId,
        requesterUserId: decision.requestedByUserId,
      },
    });
    return {
      decision: scheduled,
      evidenceSnapshotSha256: snapshotSha256,
      noteCount: notes.length,
      attachmentCount: attachments.length,
      managerAttestationCount: managerAttestations.length,
      currentManagerAttestationId: currentManagerAttestation?.id ?? null,
      structuredProbationReviewId: structuredProbationReview?.id ?? null,
    };
  });
}
