import { and, asc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import {
  positions,
  positionWfmDemandRules,
  shiftDefinitions,
  staffingRequirements,
  worksites,
} from "@/db/schema";
import {
  assertOrganizationRole,
  assertScope,
  getAccess,
  PEOPLE_ADMIN_ROLES,
  WORKFORCE_MANAGER_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import {
  enforceSameOriginMutation,
  requireSensitiveActionMfa,
} from "@/lib/security-request";
import {
  buildPositionDemandRequirements,
  normalizeDemandWeekdays,
} from "@/lib/workforce-position-demand";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function positiveInt(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const startDate = String(url.searchParams.get("startDate") ?? "");
  const endDate = String(url.searchParams.get("endDate") ?? "");
  if (!Number.isInteger(organizationId) || !ISO_DATE.test(startDate) || !ISO_DATE.test(endDate)) {
    return Response.json({ error: "organizationId and valid startDate/endDate are required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    WORKFORCE_MANAGER_ROLES,
    "Only workforce managers can review position-driven WFM demand.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "Workspace access not found." }, { status: 403 });

  const [rules, positionRows] = await Promise.all([
    db.select().from(positionWfmDemandRules).where(and(
      eq(positionWfmDemandRules.organizationId, organizationId),
      eq(positionWfmDemandRules.active, true),
      lte(positionWfmDemandRules.effectiveFrom, endDate),
      or(isNull(positionWfmDemandRules.effectiveUntil), gte(positionWfmDemandRules.effectiveUntil, startDate)),
    )).orderBy(asc(positionWfmDemandRules.positionId), asc(positionWfmDemandRules.id)),
    db.select().from(positions).where(eq(positions.organizationId, organizationId)),
  ]);
  const positionById = new Map(positionRows.map((row) => [row.id, row]));
  const visibleRules = rules.filter((rule) => {
    const position = positionById.get(rule.positionId);
    return Boolean(position && (access.companyWide || position.orgUnitId === access.orgUnitId));
  });

  const projected = buildPositionDemandRequirements({
    startDate,
    endDate,
    rules: visibleRules.flatMap((rule) => {
      const position = positionById.get(rule.positionId);
      if (!position) return [];
      return [{
        id: rule.id,
        positionId: rule.positionId,
        positionStatus: position.status,
        jobProfileId: position.jobProfileId,
        worksiteId: rule.worksiteId,
        shiftDefinitionId: rule.shiftDefinitionId,
        weekdays: normalizeDemandWeekdays(rule.weekdays),
        effectiveFrom: String(rule.effectiveFrom),
        effectiveUntil: rule.effectiveUntil ? String(rule.effectiveUntil) : null,
        requiredHeadcount: rule.requiredHeadcount,
        active: rule.active,
      }];
    }),
  });

  return Response.json({
    rules: visibleRules,
    projected,
    summary: {
      ruleCount: visibleRules.length,
      requirementRows: projected.length,
      headcountSlots: projected.reduce((sum, row) => sum + row.requiredHeadcount, 0),
    },
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const action = String(body.action ?? "");
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "Workspace access not found." }, { status: 403 });

  if (action === "create_rule") {
    const denied = await assertOrganizationRole(
      user.id,
      organizationId,
      PEOPLE_ADMIN_ROLES,
      "Only People administrators can map approved headcount into WFM demand.",
    );
    if (denied) return denied;

    const positionId = positiveInt(body.positionId);
    const worksiteId = positiveInt(body.worksiteId);
    const shiftDefinitionId = positiveInt(body.shiftDefinitionId);
    const effectiveFrom = String(body.effectiveFrom ?? "");
    const effectiveUntil = body.effectiveUntil ? String(body.effectiveUntil) : null;
    const weekdays = normalizeDemandWeekdays(body.weekdays);
    if (!positionId || !worksiteId || !shiftDefinitionId || !ISO_DATE.test(effectiveFrom) || (effectiveUntil && !ISO_DATE.test(effectiveUntil)) || weekdays.length === 0) {
      return Response.json({ error: "positionId, worksiteId, shiftDefinitionId, weekdays and valid effective dates are required." }, { status: 400 });
    }

    const [[position], [worksite], [shift]] = await Promise.all([
      db.select().from(positions).where(and(eq(positions.id, positionId), eq(positions.organizationId, organizationId))).limit(1),
      db.select().from(worksites).where(and(eq(worksites.id, worksiteId), eq(worksites.organizationId, organizationId), eq(worksites.active, true))).limit(1),
      db.select().from(shiftDefinitions).where(and(eq(shiftDefinitions.id, shiftDefinitionId), eq(shiftDefinitions.organizationId, organizationId), eq(shiftDefinitions.active, true))).limit(1),
    ]);
    if (!position || !worksite || !shift) return Response.json({ error: "Position, active worksite, or active shift not found." }, { status: 404 });
    if (!["approved", "open", "filled"].includes(position.status)) {
      return Response.json({ error: "Position must be approved, open, or filled before it can authorize WFM demand." }, { status: 409 });
    }
    const scope = assertScope(access, position.orgUnitId);
    if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });
    if (position.orgUnitId != null && worksite.orgUnitId != null && position.orgUnitId !== worksite.orgUnitId) {
      return Response.json({ error: "Position and worksite must belong to the same organization-unit scope." }, { status: 409 });
    }

    const [rule] = await db.insert(positionWfmDemandRules).values({
      organizationId,
      positionId,
      worksiteId,
      shiftDefinitionId,
      weekdays,
      effectiveFrom,
      effectiveUntil,
      requiredHeadcount: 1,
      active: true,
      createdByUserId: user.id,
      createdBy: user.name,
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "HCM position mapped to WFM demand",
      resource: position.code,
      metadata: { demandRuleId: rule.id, positionId, worksiteId, shiftDefinitionId, weekdays, effectiveFrom, effectiveUntil },
    });
    return Response.json(rule, { status: 201 });
  }

  if (action === "materialize") {
    const denied = await assertOrganizationRole(
      user.id,
      organizationId,
      WORKFORCE_MANAGER_ROLES,
      "Only workforce managers can publish position demand into staffing requirements.",
    );
    if (denied) return denied;
    const mfaDenied = requireSensitiveActionMfa(user);
    if (mfaDenied) return mfaDenied;

    const startDate = String(body.startDate ?? "");
    const endDate = String(body.endDate ?? "");
    if (!ISO_DATE.test(startDate) || !ISO_DATE.test(endDate)) {
      return Response.json({ error: "startDate and endDate are required." }, { status: 400 });
    }

    const [rules, positionRows] = await Promise.all([
      db.select().from(positionWfmDemandRules).where(and(
        eq(positionWfmDemandRules.organizationId, organizationId),
        eq(positionWfmDemandRules.active, true),
        lte(positionWfmDemandRules.effectiveFrom, endDate),
        or(isNull(positionWfmDemandRules.effectiveUntil), gte(positionWfmDemandRules.effectiveUntil, startDate)),
      )),
      db.select().from(positions).where(eq(positions.organizationId, organizationId)),
    ]);
    const positionById = new Map(positionRows.map((row) => [row.id, row]));
    const visibleRules = rules.filter((rule) => {
      const position = positionById.get(rule.positionId);
      return Boolean(position && (access.companyWide || position.orgUnitId === access.orgUnitId));
    });
    const projected = buildPositionDemandRequirements({
      startDate,
      endDate,
      rules: visibleRules.flatMap((rule) => {
        const position = positionById.get(rule.positionId);
        if (!position) return [];
        return [{
          id: rule.id,
          positionId: rule.positionId,
          positionStatus: position.status,
          jobProfileId: position.jobProfileId,
          worksiteId: rule.worksiteId,
          shiftDefinitionId: rule.shiftDefinitionId,
          weekdays: normalizeDemandWeekdays(rule.weekdays),
          effectiveFrom: String(rule.effectiveFrom),
          effectiveUntil: rule.effectiveUntil ? String(rule.effectiveUntil) : null,
          requiredHeadcount: rule.requiredHeadcount,
          active: rule.active,
        }];
      }),
    });

    const result = await db.transaction(async (tx) => {
      const conflicts: Array<{ workDate: string; worksiteId: number; shiftDefinitionId: number; jobProfileId: number }> = [];
      const touched: number[] = [];
      for (const row of projected) {
        const [existing] = await tx.select().from(staffingRequirements).where(and(
          eq(staffingRequirements.organizationId, organizationId),
          eq(staffingRequirements.worksiteId, row.worksiteId),
          eq(staffingRequirements.workDate, row.workDate),
          eq(staffingRequirements.shiftDefinitionId, row.shiftDefinitionId),
          eq(staffingRequirements.jobProfileId, row.jobProfileId),
        )).limit(1);

        if (existing && existing.sourceKind !== "hcm_position_plan") {
          conflicts.push({
            workDate: row.workDate,
            worksiteId: row.worksiteId,
            shiftDefinitionId: row.shiftDefinitionId,
            jobProfileId: row.jobProfileId,
          });
          continue;
        }

        if (existing) {
          const [updated] = await tx.update(staffingRequirements).set({
            requiredHeadcount: row.requiredHeadcount,
            sourceKind: "hcm_position_plan",
            sourceRefs: row.sourceRefs,
            notes: "Derived from approved HCM positions",
            updatedAt: new Date(),
          }).where(eq(staffingRequirements.id, existing.id)).returning({ id: staffingRequirements.id });
          touched.push(updated.id);
        } else {
          const [created] = await tx.insert(staffingRequirements).values({
            organizationId,
            worksiteId: row.worksiteId,
            workDate: row.workDate,
            shiftDefinitionId: row.shiftDefinitionId,
            jobProfileId: row.jobProfileId,
            requiredHeadcount: row.requiredHeadcount,
            sourceKind: "hcm_position_plan",
            sourceRefs: row.sourceRefs,
            notes: "Derived from approved HCM positions",
            createdBy: user.name,
            createdByUserId: user.id,
          }).returning({ id: staffingRequirements.id });
          touched.push(created.id);
        }
      }
      return { touched, conflicts };
    });

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "HCM position demand published to WFM",
      resource: `${startDate} through ${endDate}`,
      metadata: { requirementIds: result.touched, conflicts: result.conflicts, projectedRows: projected.length },
    });

    return Response.json({
      published: result.touched.length,
      conflicts: result.conflicts,
      projected: projected.length,
      requirementIds: result.touched,
    });
  }

  return Response.json({ error: "Unsupported action. Use create_rule or materialize." }, { status: 400 });
}
