import { enforceSameOriginMutation } from "@/lib/security-request";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { jobProfiles, jobRequisitions, orgUnits, positions } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const positionId = Number(body.positionId);
  if (!Number.isInteger(organizationId) || !Number.isInteger(positionId)) {
    return Response.json({ error: "organizationId and positionId are required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can open a position for recruitment.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  const [position] = await db.select().from(positions)
    .where(and(eq(positions.id, positionId), eq(positions.organizationId, organizationId)))
    .limit(1);
  if (!position) return Response.json({ error: "Position not found in this workspace." }, { status: 404 });
  if (!access.companyWide && position.orgUnitId !== access.orgUnitId) {
    return Response.json({ error: "That position is outside your assigned organization unit." }, { status: 403 });
  }
  if (!["approved", "open"].includes(position.status)) {
    return Response.json({ error: "Only approved or open positions can enter recruitment." }, { status: 409 });
  }

  const [existing] = await db.select({ id: jobRequisitions.id, status: jobRequisitions.status })
    .from(jobRequisitions)
    .where(and(eq(jobRequisitions.organizationId, organizationId), eq(jobRequisitions.positionId, positionId)))
    .orderBy(desc(jobRequisitions.id))
    .limit(1);
  if (existing && !["filled", "cancelled"].includes(existing.status)) {
    return Response.json({ error: "This position already has an active requisition.", requisitionId: existing.id }, { status: 409 });
  }

  const [profile] = await db.select().from(jobProfiles)
    .where(and(eq(jobProfiles.id, position.jobProfileId), eq(jobProfiles.organizationId, organizationId)))
    .limit(1);
  if (!profile) return Response.json({ error: "The position job profile is missing." }, { status: 409 });

  const unit = position.orgUnitId
    ? (await db.select().from(orgUnits)
        .where(and(eq(orgUnits.id, position.orgUnitId), eq(orgUnits.organizationId, organizationId)))
        .limit(1))[0]
    : null;

  const monthlyBudget = Number(position.annualBudget) > 0 ? Number(position.annualBudget) / 12 : 0;
  const created = await db.transaction(async (tx) => {
    const [requisition] = await tx.insert(jobRequisitions).values({
      organizationId,
      positionId: position.id,
      jobProfileId: profile.id,
      orgUnitId: position.orgUnitId,
      managerEmployeeId: position.managerEmployeeId,
      title: profile.title,
      department: unit?.name ?? "Unassigned",
      headcount: 1,
      salaryMin: null,
      salaryMax: monthlyBudget > 0 ? monthlyBudget.toFixed(2) : null,
      employmentType: position.employmentType,
      targetStartDate: position.plannedStartDate,
      status: "open",
      description: profile.description ?? "",
    }).returning();
    await tx.update(positions)
      .set({ status: "open", updatedAt: new Date() })
      .where(eq(positions.id, position.id));
    return requisition;
  });

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Position opened for recruitment",
    resource: position.code + " -> " + profile.title,
    metadata: { requisitionId: created.id, positionId: position.id, orgUnitId: position.orgUnitId },
  });

  return Response.json(created, { status: 201 });
}
