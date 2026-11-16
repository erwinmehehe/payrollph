import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { doleExtendedReports } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { workplaceAdmin, workplaceFeatureEnabled, workplacePrivateHeaders, workplaceNotFound } from "@/lib/ph-workplace-context";
import {
  DOLE_EXTENDED_REPORT_TYPES, DOLE_STATUSES, isOneOf, validDateRange,
  httpsReference, positiveId, limitedText, sha256Digest, mayAdvanceDoleRecord,
} from "@/lib/ph-workplace-compliance-policy";
import {
  enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";
const disabled = () => !workplaceFeatureEnabled("phDoleExtended");
const noAccess = () => Response.json({ error: "Workplace compliance not enabled." }, { status: 404 });

export async function GET(request: Request) {
  if (disabled()) return noAccess();
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const organizationId = positiveId(new URL(request.url).searchParams.get("organizationId"));
  if (!organizationId) return Response.json({ error: "Valid organizationId required." }, { status: 400 });
  const guard = await workplaceAdmin(user.id, organizationId);
  if (guard.denied) return guard.denied;
  const rows = await db.select().from(doleExtendedReports).where(and(
    eq(doleExtendedReports.organizationId, organizationId),
    eq(doleExtendedReports.legalEntityId, guard.legalEntityId!),
  )).orderBy(desc(doleExtendedReports.createdAt)).limit(100);
  return Response.json({
    reportTypes: DOLE_EXTENDED_REPORT_TYPES,
    records: rows,
    note: "Employer source/evidence tracking only. No DOLE portal filing, prescribed form or statutory applicability is certified.",
  }, { headers: workplacePrivateHeaders });
}

export async function POST(request: Request) {
  if (disabled()) return noAccess();
  const origin = enforceSameOriginMutation(request);
  if (origin) return origin;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demo = publicDemoMutationDenied(user.email, "Creating DOLE compliance evidence");
  if (demo) return demo;
  const body: Record<string, unknown> = await request.json().catch(() => ({}));
  const organizationId = positiveId(body.organizationId);
  if (!organizationId || !isOneOf(body.reportType, Object.keys(DOLE_EXTENDED_REPORT_TYPES))) {
    return Response.json({ error: "Valid organizationId and reportType required." }, { status: 400 });
  }
  if (!validDateRange(body.periodStart, body.periodEnd)) {
    return Response.json({ error: "Valid reporting start and end dates required." }, { status: 400 });
  }
  const statutoryBasisUrl = httpsReference(body.statutoryBasisUrl);
  if (!statutoryBasisUrl || !new URL(statutoryBasisUrl).hostname.endsWith(".gov.ph")) {
    return Response.json({ error: "A reviewed official Philippine government HTTPS source is required." }, { status: 400 });
  }
  const guard = await workplaceAdmin(user.id, organizationId);
  if (guard.denied) return guard.denied;
  const rate = await enforceSensitiveActionRateLimit(request, {
    userId: user.id, action: "ph-dole-create", resourceId: organizationId, limit: 20, windowMs: 300_000,
  });
  if (rate) return rate;
  const result = await db.transaction(async tx => {
    const [record] = await tx.insert(doleExtendedReports).values({
      organizationId, legalEntityId: guard.legalEntityId!,
      reportType: body.reportType as string, periodStart: body.periodStart as string,
      periodEnd: body.periodEnd as string, statutoryBasisUrl,
      recordedByUserId: user.id,
    }).returning();
    await recordAuditEvent({
      organizationId, actor: user.name, action: "DOLE extended evidence draft created",
      resource: String(record.id),
      metadata: { reportId: record.id, reportType: record.reportType, legalEntityId: record.legalEntityId,
        portalSubmittedByLinaw: false },
    }, tx);
    return record;
  });
  return Response.json({ record: result, agencySubmissionPerformed: false }, { status: 201, headers: workplacePrivateHeaders });
}

export async function PATCH(request: Request) {
  if (disabled()) return noAccess();
  const origin = enforceSameOriginMutation(request);
  if (origin) return origin;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demo = publicDemoMutationDenied(user.email, "Updating DOLE filing outcome evidence");
  if (demo) return demo;
  const body: Record<string, unknown> = await request.json().catch(() => ({}));
  const organizationId = positiveId(body.organizationId);
  const id = positiveId(body.id);
  if (!organizationId || !id || !isOneOf(body.status, DOLE_STATUSES) || body.status === "draft") {
    return Response.json({ error: "Valid record, organization and next status required." }, { status: 400 });
  }
  const guard = await workplaceAdmin(user.id, organizationId);
  if (guard.denied) return guard.denied;
  const mfa = requireSensitiveActionMfa(user);
  if (mfa) return mfa;
  const rate = await enforceSensitiveActionRateLimit(request, {
    userId: user.id, action: "ph-dole-outcome", resourceId: id, limit: 12, windowMs: 300_000,
  });
  if (rate) return rate;
  const portalReference = limitedText(body.portalReference, 160);
  const sha = body.receiptSha256 == null ? null : sha256Digest(body.receiptSha256);
  if (portalReference === null || (body.receiptSha256 != null && sha === null)) {
    return Response.json({ error: "Invalid portal reference or evidence SHA-256." }, { status: 400 });
  }
  try {
    const record = await db.transaction(async tx => {
      const [old] = await tx.select().from(doleExtendedReports).where(and(
        eq(doleExtendedReports.id, id), eq(doleExtendedReports.organizationId, organizationId),
        eq(doleExtendedReports.legalEntityId, guard.legalEntityId!),
      )).for("update").limit(1);
      if (!old) throw new Error("NOT_FOUND");
      const nextReceipt = sha || old.receiptSha256;
      const nextRef = portalReference || old.portalReference;
      if (!mayAdvanceDoleRecord(old.status as typeof DOLE_STATUSES[number], body.status as typeof DOLE_STATUSES[number], {
        hasReceipt: !!nextReceipt && !!nextRef,
        independentReviewer: body.status === "independently_reviewed" &&
          user.id !== old.recordedByUserId && user.id !== old.outcomeRecordedByUserId &&
          old.outcomeRecordedByUserId !== null,
      })) throw new Error("INVALID_TRANSITION");
      const [row] = await tx.update(doleExtendedReports).set({
        status: body.status as string, portalReference: nextRef, receiptSha256: nextReceipt,
        submittedAt: old.submittedAt ?? (body.status === "submitted_recorded" ? new Date() : null),
        reviewedByUserId: body.status === "independently_reviewed" ? user.id : old.reviewedByUserId,
        reviewedAt: body.status === "independently_reviewed" ? new Date() : old.reviewedAt,
        updatedAt: new Date(),
      }).where(and(eq(doleExtendedReports.id, old.id), eq(doleExtendedReports.organizationId, organizationId))).returning();
      await recordAuditEvent({
        organizationId, actor: user.name, action: "DOLE filing evidence state recorded",
        resource: String(id), metadata: { id, previous: old.status, status: row.status, legalEntityId: old.legalEntityId,
          externallyVerifiedByAgency: false, recordedReview: body.status === "independently_reviewed" },
      }, tx);
      return row;
    });
    return Response.json({ record, note: "Status is operator-reviewed evidence, not an API-verified agency receipt." }, { headers: workplacePrivateHeaders });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    return msg === "NOT_FOUND" ? workplaceNotFound() :
      Response.json({ error: "State transition rejected; check genuine receipt, independent reviewer and current state." }, { status: 409 });
  }
}
