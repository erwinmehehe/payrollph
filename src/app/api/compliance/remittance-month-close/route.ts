import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { statutoryRemittanceMonthClosures } from "@/db/schema";
import { assertOrganizationRole } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { loadStatutoryRemittanceMonthCloseState } from "@/lib/statutory-remittance-close-state";
import { ensureStatutoryRemittanceMonthCloseSchema } from "@/lib/statutory-remittance-month-close-schema";
import { currentManilaMonth } from "@/lib/statutory-remittance-state";
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

export async function GET(request: Request) {
  await ensureStatutoryRemittanceMonthCloseSchema();
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const applicableMonth = String(url.searchParams.get("applicableMonth") ?? "").trim();
  if (!Number.isInteger(organizationId) || !/^\d{4}-\d{2}$/.test(applicableMonth)) {
    return Response.json({ error: "organizationId and applicableMonth (YYYY-MM) are required." }, { status: 400 });
  }

  const denied = await requireRemittanceCertifier(user.id, organizationId);
  if (denied) return denied;

  const result = await loadStatutoryRemittanceMonthCloseState(organizationId, applicableMonth);
  if (!result) return Response.json({ error: "Organization not found." }, { status: 404 });
  return Response.json({
    ...result,
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

  const current = await loadStatutoryRemittanceMonthCloseState(organizationId, applicableMonth);
  if (!current) return Response.json({ error: "Organization not found." }, { status: 404 });

  const evidenceActors = new Set([
    ...current.evaluation.batches.flatMap((batch) => [
      batch.paymentRecordedBy,
      batch.reconciledBy,
    ]),
    ...current.evaluation.members.map((member) => member.confirmedBy),
    ...current.evaluation.corrections.map((correction) => correction.decidedByName),
    ...current.evaluation.issueCases.map((issue) => issue.resolvedByName),
  ].filter((value): value is string => Boolean(value && value.trim())));
  if (evidenceActors.has(user.name)) {
    return Response.json({
      error: "The certifier cannot certify a remittance month containing evidence they recorded, confirmed, corrected, or resolved. Use another Owner, Admin, or Checker.",
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
      eq(statutoryRemittanceMonthClosures.applicableMonth, applicableMonth),
      eq(statutoryRemittanceMonthClosures.snapshotHash, current.evaluation.snapshotHash),
    ))
    .limit(1);

  const closure = existingSnapshot ?? (await db.insert(statutoryRemittanceMonthClosures).values({
    organizationId,
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
