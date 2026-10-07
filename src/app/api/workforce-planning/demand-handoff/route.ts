import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  jobProfiles,
  positions,
  shiftDefinitions,
  staffingRequirements,
  workforcePlans,
  worksites,
} from "@/db/schema";
import {
  assertOrganizationRole,
  assertScope,
  getAccess,
  WORKFORCE_MANAGER_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import {
  demandDates,
  summarizePlanRoleDemand,
  validatePlanDemandHeadcount,
} from "@/lib/workforce-plan-demand";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const planId = Number(body.planId);
  const jobProfileId = Number(body.jobProfileId);
  const worksiteId = Number(body.worksiteId);
  const shiftDefinitionId = Number(body.shiftDefinitionId);
  const requiredHeadcount = Number(body.requiredHeadcount);
  const startDate = String(body.startDate ?? "");
  const endDate = String(body.endDate ?? "");

  if (
    !Number.isInteger(organizationId)
    || !Number.isInteger(planId)
    || !Number.isInteger(jobProfileId)
    || !Number.isInteger(worksiteId)
    || !Number.isInteger(shiftDefinitionId)
  ) {
    return Response.json({
      error: "organizationId, planId, jobProfileId, worksiteId and shiftDefinitionId are required.",
    }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    WORKFORCE_MANAGER_ROLES,
    "Only workforce managers can hand approved headcount into WFM demand.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "wfm-plan-demand-handoff",
    resourceId: organizationId,
    limit: 30,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  let dates: string[];
  try {
    dates = demandDates(startDate, endDate);
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Invalid demand date range.",
    }, { status: 400 });
  }

  const [[plan], [profile], [worksite], [shift], planPositions] = await Promise.all([
    db.select().from(workforcePlans).where(and(
      eq(workforcePlans.id, planId),
      eq(workforcePlans.organizationId, organizationId),
    )).limit(1),
    db.select().from(jobProfiles).where(and(
      eq(jobProfiles.id, jobProfileId),
      eq(jobProfiles.organizationId, organizationId),
      eq(jobProfiles.active, true),
    )).limit(1),
    db.select().from(worksites).where(and(
      eq(worksites.id, worksiteId),
      eq(worksites.organizationId, organizationId),
      eq(worksites.active, true),
    )).limit(1),
    db.select().from(shiftDefinitions).where(and(
      eq(shiftDefinitions.id, shiftDefinitionId),
      eq(shiftDefinitions.organizationId, organizationId),
      eq(shiftDefinitions.active, true),
    )).limit(1),
    db.select().from(positions).where(and(
      eq(positions.organizationId, organizationId),
      eq(positions.planId, planId),
      eq(positions.jobProfileId, jobProfileId),
      inArray(positions.status, ["approved", "open", "filled"]),
    )),
  ]);

  if (!plan || plan.status !== "active") {
    return Response.json({ error: "The selected workforce plan is missing or not active." }, { status: 409 });
  }
  if (!profile || !worksite || !shift) {
    return Response.json({ error: "Job profile, worksite, or shift is missing/inactive." }, { status: 404 });
  }
  if (startDate < String(plan.startDate) || endDate > String(plan.endDate)) {
    return Response.json({
      error: "WFM demand handoff must stay inside the workforce plan period.",
      planStartDate: plan.startDate,
      planEndDate: plan.endDate,
    }, { status: 409 });
  }
  if (worksite.orgUnitId == null) {
    return Response.json({
      error: "The worksite must belong to an organization unit before plan-authorized headcount can be handed into WFM.",
    }, { status: 409 });
  }

  const scope = assertScope(access, worksite.orgUnitId);
  if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });

  const role = summarizePlanRoleDemand({
    planId,
    orgUnitId: worksite.orgUnitId,
    positions: planPositions.map((position) => ({
      id: position.id,
      planId: position.planId,
      jobProfileId: position.jobProfileId,
      orgUnitId: position.orgUnitId,
      status: position.status,
    })),
  }).find((row) => row.jobProfileId === jobProfileId) ?? null;

  try {
    validatePlanDemandHeadcount({ requestedHeadcount: requiredHeadcount, role });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Headcount is not authorized by the workforce plan.",
    }, { status: 409 });
  }

  const positionIds = role?.positionIds ?? [];
  let createdOrUpdated: Array<typeof staffingRequirements.$inferSelect & { handoffAction: "created" | "updated" }>;
  try {
    createdOrUpdated = await db.transaction(async (tx) => {
    const rows = [];
    for (const workDate of dates) {
      const [existing] = await tx.select().from(staffingRequirements).where(and(
        eq(staffingRequirements.organizationId, organizationId),
        eq(staffingRequirements.worksiteId, worksiteId),
        eq(staffingRequirements.workDate, workDate),
        eq(staffingRequirements.shiftDefinitionId, shiftDefinitionId),
        eq(staffingRequirements.jobProfileId, jobProfileId),
      )).limit(1);

      const sourceHandoffKey = [
        "plan",
        planId,
        "site",
        worksiteId,
        "shift",
        shiftDefinitionId,
        "role",
        jobProfileId,
        "date",
        workDate,
      ].join(":");

      if (existing) {
        if (existing.sourceType !== "hcm_plan" || existing.sourcePlanId !== planId) {
          throw new Error(
            `A manually managed or differently sourced staffing requirement already exists for ${workDate}. Resolve it before using the HCM plan handoff.`,
          );
        }
        const [updated] = await tx.update(staffingRequirements).set({
          requiredHeadcount,
          sourcePositionIds: positionIds,
          sourceHandoffKey,
          notes: `Authorized by workforce plan ${plan.name}`,
          updatedAt: new Date(),
        }).where(eq(staffingRequirements.id, existing.id)).returning();
        rows.push({ ...updated, handoffAction: "updated" as const });
        continue;
      }

      const [created] = await tx.insert(staffingRequirements).values({
        organizationId,
        worksiteId,
        workDate,
        shiftDefinitionId,
        jobProfileId,
        requiredHeadcount,
        sourceType: "hcm_plan",
        sourcePlanId: planId,
        sourcePositionIds: positionIds,
        sourceHandoffKey,
        notes: `Authorized by workforce plan ${plan.name}`,
        createdBy: user.name,
        createdByUserId: user.id,
      }).returning();
      rows.push({ ...created, handoffAction: "created" as const });
    }
    return rows;
    });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Could not hand approved headcount into WFM demand.",
    }, { status: 409 });
  }

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "HCM workforce plan handed to WFM demand",
    resource: `${plan.name} · ${profile.title} · ${worksite.name} · ${shift.code}`,
    metadata: {
      planId,
      jobProfileId,
      worksiteId,
      shiftDefinitionId,
      requiredHeadcount,
      startDate,
      endDate,
      positionIds,
      requirementIds: createdOrUpdated.map((row) => row.id),
    },
  });

  return Response.json({
    plan: { id: plan.id, name: plan.name, startDate: plan.startDate, endDate: plan.endDate },
    role: {
      jobProfileId,
      title: profile.title,
      authorizedHeadcount: role?.authorizedHeadcount ?? 0,
      filledHeadcount: role?.filledHeadcount ?? 0,
      vacantHeadcount: role?.vacantHeadcount ?? 0,
      positionIds,
    },
    requirements: createdOrUpdated,
  }, { status: 201 });
}
