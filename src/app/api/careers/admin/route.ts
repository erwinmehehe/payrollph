import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { jobRequisitions } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { workflowEntityHold } from "@/lib/workflow-entity-hold";
import { enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";
import { recordAuditEvent } from "@/lib/audit";

export async function PATCH(request: Request) {
  if (!criticalReleaseFlagEnabled("recruitmentJourney"))
    return Response.json({ error: "Careers publishing disabled." }, { status: 404 });
  const entityHold = workflowEntityHold(); if (entityHold) return entityHold;
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
  const [job] = await db.select().from(jobRequisitions).where(and(
    eq(jobRequisitions.organizationId, organizationId), eq(jobRequisitions.id, requisitionId),
  )).limit(1);
  if (!job) return Response.json({ error: "Requisition not found." }, { status: 404 });
  if (body.published && (job.positionId === null || ["filled","cancelled"].includes(job.status))) {
    return Response.json({ error: "Only active position-governed jobs can be published." }, { status: 409 });
  }
  const [updated] = await db.update(jobRequisitions).set({ careersPublished: body.published })
    .where(and(eq(jobRequisitions.id, job.id), eq(jobRequisitions.organizationId, organizationId))).returning();
  await recordAuditEvent({ organizationId, actor: user.name,
    action: updated.careersPublished ? "Careers requisition published" : "Careers requisition unpublished",
    resource: String(updated.id), metadata: { requestedByUserId: user.id, requisitionId: updated.id } });
  return Response.json({ id: updated.id, published: updated.careersPublished });
}
