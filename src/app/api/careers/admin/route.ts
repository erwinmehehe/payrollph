import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { jobRequisitions } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { workflowEntityHold } from "@/lib/workflow-entity-hold";
import { enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";
import { auditEvents } from "@/db/schema";
import { applicantPrivacyControlsEnabled } from "@/lib/recruitment-applicant-privacy";
import { enforceSensitiveActionRateLimit } from "@/lib/security-request";

export async function PATCH(request: Request) {
  if (!criticalReleaseFlagEnabled("recruitmentJourney"))
    return Response.json({ error: "Careers publishing disabled." }, { status: 404 });
  const entityHold = workflowEntityHold(); if (entityHold) return entityHold;
  if (!applicantPrivacyControlsEnabled() || !criticalReleaseFlagEnabled("publicIntakeProof") ||
      !/^[A-Za-z0-9._-]{2,64}$/.test(process.env.CAREERS_PRIVACY_NOTICE_VERSION ?? "") ||
      !/^https:\/\/[^\s]+$/.test(process.env.CAREERS_PRIVACY_NOTICE_URL ?? ""))
    return Response.json({ error: "Careers publishing requires approved privacy controls." }, { status: 404 });
  const origin = enforceSameOriginMutation(request); if (origin) return origin;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId), requisitionId = Number(body.requisitionId);
  if (![organizationId,requisitionId].every(n=>Number.isSafeInteger(n)&&n>0) || typeof body.published !== "boolean")
    return Response.json({ error: "Valid employer, requisition and publish state required." }, { status: 400 });
  const denied = await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES);
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide || !["owner","admin","hr"].includes(access.role))
    return Response.json({ error: "Company-wide recruitment editor required." }, { status: 403 });
  const mfa = requireSensitiveActionMfa(user);
  if (mfa) return mfa;
  const rate = await enforceSensitiveActionRateLimit(request, { userId: user.id, action: "careers-publish", resourceId: organizationId, limit: 8 });
  if (rate) return rate;
  const [job] = await db.select().from(jobRequisitions).where(and(
    eq(jobRequisitions.organizationId, organizationId), eq(jobRequisitions.id, requisitionId),
  )).limit(1);
  if (!job) return Response.json({ error: "Requisition not found." }, { status: 404 });
  if (body.published && (job.positionId === null || ["filled","cancelled"].includes(job.status))) {
    return Response.json({ error: "Only active position-governed jobs can be published." }, { status: 409 });
  }
  const updated = await db.transaction(async tx => {
    const [row] = await tx.update(jobRequisitions).set({ careersPublished: body.published })
      .where(and(eq(jobRequisitions.id, job.id), eq(jobRequisitions.organizationId, organizationId),
        ...(body.published ? [sql`${jobRequisitions.positionId} is not null`, sql`${jobRequisitions.status} in ('open', 'interviewing')`] : [])))
      .returning();
    if (!row) return null;
    await tx.insert(auditEvents).values({ organizationId, actor: user.name,
      action: row.careersPublished ? "Careers requisition published" : "Careers requisition unpublished",
      resource: String(row.id), metadata: { requestedByUserId: user.id, requisitionId: row.id } });
    return row;
  });
  if (!updated) return Response.json({ error: "Requisition status changed; reload." }, { status: 409 });
  return Response.json({ id: updated.id, published: updated.careersPublished });
}
