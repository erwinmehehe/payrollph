import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { oshSafetyEvents } from "@/db/workplace-compliance-schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { workplaceAdmin, workplaceFeatureEnabled, workplacePrivateHeaders, workplaceNotFound } from "@/lib/ph-workplace-context";
import {
  OSH_EVENT_KINDS, OSH_SEVERITIES, OSH_EVENT_STATUSES, isOneOf, positiveId,
  limitedText, phCivilDate, sha256Digest,
} from "@/lib/ph-workplace-compliance-policy";
import { enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa } from "@/lib/security-request";

export const dynamic = "force-dynamic";
const noAccess = () => Response.json({ error: "Not found." }, { status: 404 });

export async function GET(request: Request) {
  if (!workplaceFeatureEnabled("phOshRecords")) return noAccess();
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const organizationId = positiveId(new URL(request.url).searchParams.get("organizationId"));
  if (!organizationId) return Response.json({ error: "Valid organizationId required." }, { status: 400 });
  const guard = await workplaceAdmin(user.id, organizationId);
  if (guard.denied) return guard.denied;
  const events = await db.select().from(oshSafetyEvents).where(and(
    eq(oshSafetyEvents.organizationId, organizationId),
    eq(oshSafetyEvents.legalEntityId, guard.legalEntityId!),
  )).orderBy(desc(oshSafetyEvents.occurredOn), desc(oshSafetyEvents.id)).limit(100);
  return Response.json({
    events,
    kinds: OSH_EVENT_KINDS, severities: OSH_SEVERITIES,
    note: "Minimal incident/corrective-action register, not a Work Accident/Illness Report or medical record.",
  }, { headers: workplacePrivateHeaders });
}

export async function POST(request: Request) {
  if (!workplaceFeatureEnabled("phOshRecords")) return noAccess();
  const origin = enforceSameOriginMutation(request);
  if (origin) return origin;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demo = publicDemoMutationDenied(user.email, "Recording workplace safety events");
  if (demo) return demo;
  const body: Record<string, unknown> = await request.json().catch(() => ({}));
  const organizationId = positiveId(body.organizationId);
  const worksiteLabel = limitedText(body.worksiteLabel, 120, true);
  const occurredOn = phCivilDate(body.occurredOn);
  if (!organizationId || !worksiteLabel || !occurredOn ||
    !isOneOf(body.eventKind, OSH_EVENT_KINDS) || !isOneOf(body.severity, OSH_SEVERITIES)) {
    return Response.json({ error: "Valid employer, worksite, date, event kind and severity required." }, { status: 400 });
  }
  const sha = body.evidenceSha256 == null ? null : sha256Digest(body.evidenceSha256);
  if (body.evidenceSha256 != null && !sha) return Response.json({ error: "Invalid SHA-256 proof." }, { status: 400 });
  const guard = await workplaceAdmin(user.id, organizationId);
  if (guard.denied) return guard.denied;
  const rate = await enforceSensitiveActionRateLimit(request, {
    userId: user.id, action: "ph-osh-create", resourceId: organizationId, limit: 20, windowMs: 300_000,
  });
  if (rate) return rate;
  const row = await db.transaction(async tx => {
    const [created] = await tx.insert(oshSafetyEvents).values({
      organizationId, legalEntityId: guard.legalEntityId!, worksiteLabel, occurredOn,
      eventKind: body.eventKind as string, severity: body.severity as string,
      evidenceSha256: sha, actionOwnerUserId: user.id, recordedByUserId: user.id,
    }).returning();
    await recordAuditEvent({
      organizationId, actor: user.name, action: "OSH safety event metadata created",
      resource: String(created.id), metadata: {
        eventId: created.id, eventKind: created.eventKind, status: created.status, legalEntityId: created.legalEntityId,
        containsMedicalNarrative: false, agencySubmissionPerformed: false,
      },
    }, tx);
    return created;
  });
  return Response.json({ event: row }, { status: 201, headers: workplacePrivateHeaders });
}

export async function PATCH(request: Request) {
  if (!workplaceFeatureEnabled("phOshRecords")) return noAccess();
  const origin = enforceSameOriginMutation(request);
  if (origin) return origin;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demo = publicDemoMutationDenied(user.email, "Reviewing workplace safety events");
  if (demo) return demo;
  const body: Record<string, unknown> = await request.json().catch(() => ({}));
  const organizationId = positiveId(body.organizationId);
  const id = positiveId(body.id);
  if (!organizationId || !id || !isOneOf(body.status, OSH_EVENT_STATUSES) || body.status === "open") {
    return Response.json({ error: "Valid event and next status required." }, { status: 400 });
  }
  const guard = await workplaceAdmin(user.id, organizationId);
  if (guard.denied) return guard.denied;
  const mfa = requireSensitiveActionMfa(user);
  if (mfa) return mfa;
  const rate = await enforceSensitiveActionRateLimit(request, {
    userId: user.id, action: "ph-osh-update", resourceId: id, limit: 20, windowMs: 300_000,
  });
  if (rate) return rate;
  const sha = body.evidenceSha256 == null ? null : sha256Digest(body.evidenceSha256);
  const correctiveActionRef = limitedText(body.correctiveActionRef, 160);
  if ((body.evidenceSha256 != null && !sha) || correctiveActionRef === null) {
    return Response.json({ error: "Invalid corrective-action evidence." }, { status: 400 });
  }
  try {
    const row = await db.transaction(async tx => {
      const [old] = await tx.select().from(oshSafetyEvents).where(and(
        eq(oshSafetyEvents.id, id), eq(oshSafetyEvents.organizationId, organizationId),
        eq(oshSafetyEvents.legalEntityId, guard.legalEntityId!),
      )).for("update").limit(1);
      if (!old) throw new Error("NOT_FOUND");
      if (!(old.status === "open" && ["mitigating", "resolved"].includes(body.status as string)) &&
        !(old.status === "mitigating" && body.status === "resolved")) throw new Error("BAD_TRANSITION");
      const nextSha = sha || old.evidenceSha256;
      const nextRef = correctiveActionRef || old.correctiveActionRef;
      if (body.status === "resolved" && (!nextSha || !nextRef || old.recordedByUserId === user.id)) {
        throw new Error("INDEPENDENT_REVIEW_REQUIRED");
      }
      const [updated] = await tx.update(oshSafetyEvents).set({
        status: body.status as string, evidenceSha256: nextSha, correctiveActionRef: nextRef,
        reviewedAt: body.status === "resolved" ? new Date() : old.reviewedAt,
        reviewedByUserId: body.status === "resolved" ? user.id : old.reviewedByUserId,
        updatedAt: new Date(),
      }).where(and(eq(oshSafetyEvents.id, id), eq(oshSafetyEvents.organizationId, organizationId))).returning();
      await recordAuditEvent({
        organizationId, actor: user.name, action: "OSH corrective-action state changed",
        resource: String(id), metadata: { id, oldStatus: old.status, status: updated.status,
          independentReview: body.status === "resolved", agencySubmitted: false },
      }, tx);
      return updated;
    });
    return Response.json({ event: row }, { headers: workplacePrivateHeaders });
  } catch (e) {
    return e instanceof Error && e.message === "NOT_FOUND" ? workplaceNotFound() :
      Response.json({ error: "Event cannot be closed without independent review and protected evidence." }, { status: 409 });
  }
}
