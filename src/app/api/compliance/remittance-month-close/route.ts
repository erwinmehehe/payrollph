import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  payrollEntries,
  payrollRuns,
  statutoryContributionIssueCases,
  statutoryRemittanceCorrectionRequests,
  statutoryRemittanceMonthClosures,
  statutoryRemittancePaymentEvidence,
} from "@/db/schema";
import { assertOrganizationRole } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { resolveComplianceLegalEntity } from "@/lib/legal-entity";
import { evaluateRemittanceMonthClose } from "@/lib/statutory-remittance-close";
import {
  buildEvidenceActorIdentity,
  certifierConflictsWithEvidence,
} from "@/lib/statutory-remittance-independence";
import { ensureStatutoryRemittanceMonthCloseSchema } from "@/lib/statutory-remittance-month-close-schema";
import {
  currentManilaMonth,
  loadStatutoryRemittanceState,
  statutoryLiabilityKeys,
} from "@/lib/statutory-remittance-state";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

const REMITTANCE_CLOSE_ROLES = ["owner", "admin", "checker"] as const;

async function requireRemittanceCertifier(userId: number, organizationId: number) {
  return assertOrganizationRole(
    userId,
    organizationId,
    REMITTANCE_CLOSE_ROLES,
    "Only an Owner, Admin, or Checker can independently certify statutory remittance month close.",
  );
}

function monthStart(month: string) {
  return `${month}-01`;
}

function monthEnd(month: string) {
  const [year, rawMonth] = month.split("-").map(Number);
  return new Date(Date.UTC(year, rawMonth, 0)).toISOString().slice(0, 10);
}

async function loadCloseState(organizationId: number, legalEntityId: number, applicableMonth: string) {
  const state = await loadStatutoryRemittanceState(organizationId, legalEntityId);
  if (!state) return null;

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

  const paymentEvidence = monthBatchIds.length
    ? await db.select({
        id: statutoryRemittancePaymentEvidence.id,
        batchId: statutoryRemittancePaymentEvidence.batchId,
        fileName: statutoryRemittancePaymentEvidence.fileName,
        fileSha256: statutoryRemittancePaymentEvidence.fileSha256,
        byteSize: statutoryRemittancePaymentEvidence.byteSize,
        status: statutoryRemittancePaymentEvidence.status,
        uploadedByUserId: statutoryRemittancePaymentEvidence.uploadedByUserId,
        uploadedByName: statutoryRemittancePaymentEvidence.uploadedByName,
        uploadedAt: statutoryRemittancePaymentEvidence.uploadedAt,
      }).from(statutoryRemittancePaymentEvidence).where(and(
        eq(statutoryRemittancePaymentEvidence.organizationId, organizationId),
        inArray(statutoryRemittancePaymentEvidence.batchId, monthBatchIds),
      ))
    : [];

  const evaluation = evaluateRemittanceMonthClose({
    applicableMonth,
    batches: state.batches,
    members: state.members,
    alerts: state.alerts,
    corrections,
    paymentEvidence,
    issueCases,
    requiredAgencies,
    allPayrollRunsReleased:
      monthRuns.length > 0 && monthRuns.every((run) => run.status === "Released"),
  });

  const closures = await db.select().from(statutoryRemittanceMonthClosures)
    .where(and(
      eq(statutoryRemittanceMonthClosures.organizationId, organizationId),
      eq(statutoryRemittanceMonthClosures.legalEntityId, legalEntityId),
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

  const monthBatchIdSet = new Set(monthBatchIds);
  const evidenceActorIdentity = buildEvidenceActorIdentity([
    ...state.batches
      .filter((batch) => batch.applicableMonth === applicableMonth)
      .flatMap((batch) => [
        { userId: batch.paymentRecordedByUserId, name: batch.paymentRecordedBy },
        { userId: batch.reconciledByUserId, name: batch.reconciledBy },
      ]),
    ...state.members
      .filter((member) => monthBatchIdSet.has(member.batchId))
      .map((member) => ({
        userId: member.confirmedByUserId,
        name: member.confirmedBy,
      })),
    ...corrections.map((correction) => ({
      userId: correction.decidedByUserId,
      name: correction.decidedByName,
    })),
    ...issueCases.map((issue) => ({
      userId: issue.resolvedByUserId,
      name: issue.resolvedByName,
    })),
    ...paymentEvidence
      .filter((evidence) => evidence.status === "active")
      .map((evidence) => ({
        userId: evidence.uploadedByUserId,
        name: evidence.uploadedByName,
      })),
  ]);

  return {
    evaluation,
    closure,
    certificationHistory: closures,
    certificationValid,
    evidenceActorIdentity,
  };
}

export async function GET(request: Request) {
  await ensureStatutoryRemittanceMonthCloseSchema();
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const requestedLegalEntityId = Number(url.searchParams.get("legalEntityId") ?? 0);
  const applicableMonth = String(url.searchParams.get("applicableMonth") ?? "").trim();
  if (!Number.isInteger(organizationId) || !/^\d{4}-\d{2}$/.test(applicableMonth)) {
    return Response.json({ error: "organizationId and applicableMonth (YYYY-MM) are required." }, { status: 400 });
  }

  const denied = await requireRemittanceCertifier(user.id, organizationId);
  if (denied) return denied;

  let legalEntity;
  try {
    legalEntity = await resolveComplianceLegalEntity({
      organizationId,
      legalEntityId: requestedLegalEntityId || null,
    });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Legal employer could not be resolved.",
    }, { status: 409 });
  }

  let legalEntity;
  try {
    legalEntity = await resolveComplianceLegalEntity({
      organizationId,
      legalEntityId: requestedLegalEntityId || null,
    });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Legal employer could not be resolved.",
    }, { status: 409 });
  }

  const result = await loadCloseState(organizationId, legalEntity.id, applicableMonth);
  if (!result) return Response.json({ error: "Organization or legal employer not found." }, { status: 404 });
  const { evidenceActorIdentity: _evidenceActorIdentity, ...publicResult } = result;
  return Response.json({
    ...publicResult,
    legalEntity: { id: legalEntity.id, code: legalEntity.code, displayName: legalEntity.displayName },
    certificationRole: "independent-reviewer",
  });
}

export async function POST(request: Request) {
  await ensureStatutoryRemittanceMonthCloseSchema();
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const requestedLegalEntityId = Number(body.legalEntityId ?? 0);
  const applicableMonth = String(body.applicableMonth ?? "").trim();
  if (!Number.isInteger(organizationId) || !/^\d{4}-\d{2}$/.test(applicableMonth)) {
    return Response.json({ error: "organizationId and applicableMonth (YYYY-MM) are required." }, { status: 400 });
  }

  const denied = await requireRemittanceCertifier(user.id, organizationId);
  if (denied) return denied;
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "statutory-remittance-month-close",
    resourceId: organizationId,
    limit: 20,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (applicableMonth >= currentManilaMonth()) {
    return Response.json({
      error: "Only a fully closed prior payroll month can be certified.",
    }, { status: 409 });
  }

  const current = await loadCloseState(organizationId, legalEntity.id, applicableMonth);
  if (!current) return Response.json({ error: "Organization not found." }, { status: 404 });

  if (certifierConflictsWithEvidence({
    certifierUserId: user.id,
    certifierName: user.name,
    evidence: current.evidenceActorIdentity,
  })) {
    return Response.json({
      error: "The certifier cannot certify a remittance month containing evidence they recorded, uploaded, confirmed, corrected, or resolved. Use another Owner, Admin, or Checker.",
    }, { status: 409 });
  }

  if (!current.evaluation.ready) {
    return Response.json({
      error: "This remittance month is not ready to certify.",
      blockers: current.evaluation.blockers,
    }, { status: 409 });
  }

  const now = new Date();
  const [existingSnapshot] = await db.select().from(statutoryRemittanceMonthClosures)
    .where(and(
      eq(statutoryRemittanceMonthClosures.organizationId, organizationId),
      eq(statutoryRemittanceMonthClosures.legalEntityId, legalEntity.id),
      eq(statutoryRemittanceMonthClosures.applicableMonth, applicableMonth),
      eq(statutoryRemittanceMonthClosures.snapshotHash, current.evaluation.snapshotHash),
    ))
    .limit(1);

  const closure = existingSnapshot ?? (await db.insert(statutoryRemittanceMonthClosures).values({
    organizationId,
    legalEntityId: legalEntity.id,
    applicableMonth,
    status: "certified",
    snapshotHash: current.evaluation.snapshotHash,
    certifiedByUserId: user.id,
    certifiedByName: user.name,
    certifiedAt: now,
  }).returning())[0];

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Statutory remittance month certified",
    resource: applicableMonth,
    metadata: {
      closureId: closure.id,
      legalEntityId: legalEntity.id,
      legalEntityCode: legalEntity.code,
      applicableMonth,
      snapshotHash: current.evaluation.snapshotHash,
      agencyCount: current.evaluation.agencyCount,
      memberCount: current.evaluation.memberCount,
    },
  });

  return Response.json({
    closure,
    certificationValid: true,
    certificationHistoryPreserved: true,
    evaluation: current.evaluation,
  });
}
