import { enforceSameOriginMutation } from "@/lib/security-request";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  jobProfiles,
  jobRequisitions,
  orgUnits,
  positionAssignments,
  positions,
  workforcePlans,
} from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import {
  assertOrganizationRole,
  assertScope,
  getAccess,
  PEOPLE_ADMIN_ROLES,
  WORKFORCE_MANAGER_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

const POSITION_STATUSES = ["planned", "approved", "open", "filled", "frozen", "closed"] as const;

class WorkforcePlanningConflict extends Error {
  constructor(message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = "WorkforcePlanningConflict";
  }
}

function isoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function scopedUnit(userId: number, organizationId: number, orgUnitId: number | null) {
  const access = await getAccess(userId, organizationId);
  if (!access) return { error: Response.json({ error: "You do not have access to this workspace." }, { status: 403 }) };
  if (access.companyWide) return { access };
  if (orgUnitId != null && orgUnitId === access.orgUnitId) return { access };
  return { error: Response.json({ error: "This position is outside your assigned organization unit." }, { status: 403 }) };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) return Response.json({ error: "organizationId is required." }, { status: 400 });

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    WORKFORCE_MANAGER_ROLES,
    "Your role is not allowed to view workforce planning.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  const [profiles, plans, allPositions, assignments, units, staff, requisitions] = await Promise.all([
    db.select().from(jobProfiles).where(eq(jobProfiles.organizationId, organizationId)).orderBy(jobProfiles.title),
    db.select().from(workforcePlans).where(eq(workforcePlans.organizationId, organizationId)).orderBy(desc(workforcePlans.startDate)),
    db.select().from(positions).where(eq(positions.organizationId, organizationId)).orderBy(desc(positions.id)),
    db.select().from(positionAssignments).where(eq(positionAssignments.organizationId, organizationId)).orderBy(desc(positionAssignments.effectiveFrom)),
    db.select().from(orgUnits).where(eq(orgUnits.organizationId, organizationId)).orderBy(orgUnits.name),
    db.select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      title: employees.title,
      orgUnitId: employees.orgUnitId,
      status: employees.status,
    }).from(employees).where(eq(employees.organizationId, organizationId)),
    db.select({
      id: jobRequisitions.id,
      positionId: jobRequisitions.positionId,
      status: jobRequisitions.status,
      createdAt: jobRequisitions.createdAt,
    }).from(jobRequisitions)
      .where(eq(jobRequisitions.organizationId, organizationId))
      .orderBy(desc(jobRequisitions.id)),
  ]);

  const visiblePositions = access.companyWide
    ? allPositions
    : allPositions.filter((position) => position.orgUnitId === access.orgUnitId);
  const visiblePositionIds = new Set(visiblePositions.map((position) => position.id));
  const visibleEmployees = access.companyWide
    ? staff
    : staff.filter((employee) => employee.orgUnitId === access.orgUnitId);

  const activeRequisitionByPosition = new Map<number, (typeof requisitions)[number]>();
  for (const requisition of requisitions) {
    if (
      requisition.positionId != null &&
      !activeRequisitionByPosition.has(requisition.positionId) &&
      !["filled", "cancelled"].includes(requisition.status)
    ) {
      activeRequisitionByPosition.set(requisition.positionId, requisition);
    }
  }

  return Response.json({
    profiles,
    plans,
    positions: visiblePositions.map((position) => {
      const activeRequisition = activeRequisitionByPosition.get(position.id);
      return {
        ...position,
        activeRequisitionId: activeRequisition?.id ?? null,
        activeRequisitionStatus: activeRequisition?.status ?? null,
      };
    }),
    assignments: assignments.filter((assignment) => visiblePositionIds.has(assignment.positionId)),
    orgUnits: access.companyWide ? units : units.filter((unit) => unit.id === access.orgUnitId),
    employees: visibleEmployees,
    access,
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const entityType = String(body.entityType ?? "");
  if (!Number.isInteger(organizationId)) return Response.json({ error: "organizationId is required." }, { status: 400 });

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    WORKFORCE_MANAGER_ROLES,
    "Your role is not allowed to manage workforce planning.",
  );
  if (denied) return denied;

  if (entityType === "profile") {
    const adminDenied = await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES);
    if (adminDenied) return adminDenied;
    const access = await getAccess(user.id, organizationId);
    if (!access?.companyWide) return Response.json({ error: "Job architecture requires company-wide access." }, { status: 403 });

    const title = String(body.title ?? "").trim();
    const family = String(body.family ?? "General").trim();
    const level = String(body.level ?? "Individual Contributor").trim();
    if (!title) return Response.json({ error: "Job title is required." }, { status: 400 });

    try {
      const [row] = await db.insert(jobProfiles).values({
        organizationId,
        title: title.slice(0, 160),
        family: family.slice(0, 120) || "General",
        level: level.slice(0, 80) || "Individual Contributor",
        grade: body.grade ? String(body.grade).slice(0, 40) : null,
        description: body.description ? String(body.description).slice(0, 4000) : null,
      }).returning();
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Job profile created",
        resource: row.title,
        metadata: { jobProfileId: row.id, family: row.family, level: row.level },
      });
      return Response.json(row, { status: 201 });
    } catch {
      return Response.json({ error: "A job profile with this title and level already exists." }, { status: 409 });
    }
  }

  if (entityType === "plan") {
    const adminDenied = await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES);
    if (adminDenied) return adminDenied;
    const access = await getAccess(user.id, organizationId);
    if (!access?.companyWide) return Response.json({ error: "Workforce plans require company-wide access." }, { status: 403 });

    const name = String(body.name ?? "").trim();
    const startDate = String(body.startDate ?? "");
    const endDate = String(body.endDate ?? "");
    const budget = Number(body.budget ?? 0);
    if (!name || !isoDate(startDate) || !isoDate(endDate) || endDate < startDate || !Number.isFinite(budget) || budget < 0) {
      return Response.json({ error: "name, valid dates, and a non-negative budget are required." }, { status: 400 });
    }

    try {
      const [row] = await db.insert(workforcePlans).values({
        organizationId,
        name: name.slice(0, 160),
        startDate,
        endDate,
        budget: budget.toFixed(2),
        status: "active",
        createdByUserId: user.id,
        createdBy: user.name,
      }).returning();
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Workforce plan created",
        resource: row.name,
        metadata: { planId: row.id, budget },
      });
      return Response.json(row, { status: 201 });
    } catch {
      return Response.json({ error: "A workforce plan with this name and period already exists." }, { status: 409 });
    }
  }

  if (entityType === "position") {
    const code = String(body.code ?? "").trim().toUpperCase();
    const jobProfileId = Number(body.jobProfileId);
    const orgUnitId = body.orgUnitId ? Number(body.orgUnitId) : null;
    const planId = body.planId ? Number(body.planId) : null;
    const managerEmployeeId = body.managerEmployeeId ? Number(body.managerEmployeeId) : null;
    const annualBudget = Number(body.annualBudget ?? 0);
    const plannedStartDate = body.plannedStartDate ? String(body.plannedStartDate) : null;
    if (!code || !Number.isInteger(jobProfileId) || !Number.isFinite(annualBudget) || annualBudget < 0) {
      return Response.json({ error: "code, jobProfileId, and a non-negative annualBudget are required." }, { status: 400 });
    }
    if (plannedStartDate && !isoDate(plannedStartDate)) return Response.json({ error: "plannedStartDate must be YYYY-MM-DD." }, { status: 400 });

    const unitScope = await scopedUnit(user.id, organizationId, orgUnitId);
    if ("error" in unitScope) return unitScope.error;

    const [profile] = await db.select({ id: jobProfiles.id }).from(jobProfiles)
      .where(and(eq(jobProfiles.id, jobProfileId), eq(jobProfiles.organizationId, organizationId))).limit(1);
    if (!profile) return Response.json({ error: "Job profile not found in this workspace." }, { status: 404 });

    if (orgUnitId) {
      const [unit] = await db.select({ id: orgUnits.id }).from(orgUnits)
        .where(and(eq(orgUnits.id, orgUnitId), eq(orgUnits.organizationId, organizationId))).limit(1);
      if (!unit) return Response.json({ error: "Organization unit not found in this workspace." }, { status: 404 });
    }
    if (planId) {
      const [plan] = await db.select({ id: workforcePlans.id }).from(workforcePlans)
        .where(and(eq(workforcePlans.id, planId), eq(workforcePlans.organizationId, organizationId))).limit(1);
      if (!plan) return Response.json({ error: "Workforce plan not found in this workspace." }, { status: 404 });
    }
    if (managerEmployeeId) {
      const [manager] = await db.select({ id: employees.id, orgUnitId: employees.orgUnitId }).from(employees)
        .where(and(eq(employees.id, managerEmployeeId), eq(employees.organizationId, organizationId))).limit(1);
      if (!manager) return Response.json({ error: "Manager employee not found in this workspace." }, { status: 404 });
      const access = await getAccess(user.id, organizationId);
      const managerScope = assertScope(access, manager.orgUnitId);
      if (!managerScope.ok) return Response.json({ error: managerScope.error }, { status: managerScope.status });
    }

    try {
      const [row] = await db.insert(positions).values({
        organizationId,
        code: code.slice(0, 48),
        jobProfileId,
        orgUnitId,
        planId,
        managerEmployeeId,
        employmentType: body.employmentType ? String(body.employmentType).slice(0, 32) : "Regular",
        status: "planned",
        plannedStartDate,
        annualBudget: annualBudget.toFixed(2),
        notes: body.notes ? String(body.notes).slice(0, 4000) : null,
        createdByUserId: user.id,
      }).returning();
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Position created",
        resource: row.code,
        metadata: { positionId: row.id, jobProfileId, orgUnitId, planId, annualBudget },
      });
      return Response.json(row, { status: 201 });
    } catch {
      return Response.json({ error: "A position with this code already exists." }, { status: 409 });
    }
  }

  if (entityType === "assignment") {
    const positionId = Number(body.positionId);
    const employeeId = Number(body.employeeId);
    const effectiveFrom = String(body.effectiveFrom ?? "");
    if (!Number.isInteger(positionId) || !Number.isInteger(employeeId) || !isoDate(effectiveFrom)) {
      return Response.json({ error: "positionId, employeeId, and effectiveFrom are required." }, { status: 400 });
    }

    const [position] = await db.select().from(positions)
      .where(and(eq(positions.id, positionId), eq(positions.organizationId, organizationId))).limit(1);
    if (!position) return Response.json({ error: "Position not found in this workspace." }, { status: 404 });
    const unitScope = await scopedUnit(user.id, organizationId, position.orgUnitId);
    if ("error" in unitScope) return unitScope.error;
    if (!["approved", "open"].includes(position.status)) {
      return Response.json({
        error: "A position must be approved or actively recruiting before an incumbent can be assigned.",
        positionStatus: position.status,
      }, { status: 409 });
    }

    const [employee] = await db.select({ id: employees.id, orgUnitId: employees.orgUnitId }).from(employees)
      .where(and(eq(employees.id, employeeId), eq(employees.organizationId, organizationId))).limit(1);
    if (!employee) return Response.json({ error: "Employee not found in this workspace." }, { status: 404 });
    const access = await getAccess(user.id, organizationId);
    const employeeScope = assertScope(access, employee.orgUnitId);
    if (!employeeScope.ok) return Response.json({ error: employeeScope.error }, { status: employeeScope.status });

    const rowOrResponse = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(4102, ${positionId})`);

      const [freshPosition] = await tx.select({ status: positions.status })
        .from(positions)
        .where(and(
          eq(positions.id, positionId),
          eq(positions.organizationId, organizationId),
        ))
        .limit(1);
      if (!freshPosition || !["approved", "open"].includes(freshPosition.status)) {
        throw new WorkforcePlanningConflict("A position must still be approved or open before an incumbent can be assigned.", {
          positionStatus: freshPosition?.status ?? "missing",
        });
      }

      const freshRequisitions = await tx.select({ id: jobRequisitions.id, status: jobRequisitions.status })
        .from(jobRequisitions)
        .where(and(
          eq(jobRequisitions.organizationId, organizationId),
          eq(jobRequisitions.positionId, positionId),
        ))
        .orderBy(desc(jobRequisitions.id));
      const activeRequisition = freshRequisitions.find((row) => !["filled", "cancelled"].includes(row.status));
      if (activeRequisition) {
        throw new WorkforcePlanningConflict(
          "This position has an active requisition. Fill it through Recruitment or close the requisition before assigning an incumbent directly.",
          { requisitionId: activeRequisition.id, requisitionStatus: activeRequisition.status },
        );
      }

      const [openAssignment] = await tx.select({ id: positionAssignments.id })
        .from(positionAssignments)
        .where(and(
          eq(positionAssignments.positionId, positionId),
          isNull(positionAssignments.effectiveUntil),
        ))
        .limit(1);
      if (openAssignment) {
        throw new WorkforcePlanningConflict("This position already has an active assignment.");
      }

      const [assignment] = await tx.insert(positionAssignments).values({
        organizationId,
        positionId,
        employeeId,
        effectiveFrom,
        reason: body.reason ? String(body.reason).slice(0, 240) : "Position assignment",
        createdByUserId: user.id,
      }).returning();

      await tx.update(positions)
        .set({ status: "filled", updatedAt: new Date() })
        .where(eq(positions.id, positionId));

      return assignment;
    }).catch((error: unknown) => {
      if (error instanceof WorkforcePlanningConflict) {
        return Response.json({ error: error.message, ...error.details }, { status: 409 });
      }
      throw error;
    });
    if (rowOrResponse instanceof Response) return rowOrResponse;
    const row = rowOrResponse;

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Employee assigned to position",
      resource: position.code,
      metadata: {
        positionId,
        employeeId,
        assignmentId: row.id,
        effectiveFrom,
        requisitionId: null,
      },
    });
    return Response.json(row, { status: 201 });
  }

  return Response.json({ error: "entityType must be profile, plan, position, or assignment." }, { status: 400 });
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  const status = String(body.status ?? "");
  if (!Number.isInteger(id) || !POSITION_STATUSES.includes(status as (typeof POSITION_STATUSES)[number])) {
    return Response.json({ error: "Position id and valid status are required." }, { status: 400 });
  }

  const [position] = await db.select().from(positions).where(eq(positions.id, id)).limit(1);
  if (!position) return Response.json({ error: "Position not found." }, { status: 404 });

  const denied = await assertOrganizationRole(user.id, position.organizationId, WORKFORCE_MANAGER_ROLES);
  if (denied) return denied;
  const unitScope = await scopedUnit(user.id, position.organizationId, position.orgUnitId);
  if ("error" in unitScope) return unitScope.error;

  const resultOrResponse = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(4102, ${position.id})`);

    const [freshPosition] = await tx.select({
      status: positions.status,
    }).from(positions).where(and(
      eq(positions.id, position.id),
      eq(positions.organizationId, position.organizationId),
    )).limit(1);
    if (!freshPosition) {
      throw new WorkforcePlanningConflict("Position no longer exists.");
    }

    const freshRequisitions = await tx.select({ id: jobRequisitions.id, status: jobRequisitions.status })
      .from(jobRequisitions)
      .where(and(
        eq(jobRequisitions.organizationId, position.organizationId),
        eq(jobRequisitions.positionId, position.id),
      ))
      .orderBy(desc(jobRequisitions.id));
    const activeRequisition = freshRequisitions.find((row) => !["filled", "cancelled"].includes(row.status));

    const [activeAssignment] = await tx.select({ id: positionAssignments.id }).from(positionAssignments)
      .where(and(eq(positionAssignments.positionId, id), isNull(positionAssignments.effectiveUntil))).limit(1);

    if (status === "open" && !activeRequisition) {
      throw new WorkforcePlanningConflict("A position becomes open only by creating a requisition from the Recruitment workflow.");
    }

    if (freshPosition.status === "filled" && status !== "filled" && activeAssignment) {
      throw new WorkforcePlanningConflict("End the active position assignment before changing a filled position's lifecycle state.");
    }

    if (status === "filled" && !activeAssignment) {
      throw new WorkforcePlanningConflict("A position can be marked filled only through an active employee assignment.");
    }

    if (activeRequisition && freshPosition.status === "open" && !["open", "filled", "frozen", "closed"].includes(status)) {
      throw new WorkforcePlanningConflict("An actively recruiting position can only remain open, be filled, frozen, or closed.");
    }

    const cancelRequisition = Boolean(activeRequisition && ["filled", "frozen", "closed"].includes(status));
    if (activeRequisition && cancelRequisition) {
      await tx.update(jobRequisitions)
        .set({ status: "cancelled" })
        .where(eq(jobRequisitions.id, activeRequisition.id));
    }

    const [updated] = await tx.update(positions)
      .set({ status, updatedAt: new Date() })
      .where(eq(positions.id, id))
      .returning();

    return {
      updated,
      fromStatus: freshPosition.status,
      requisitionId: activeRequisition?.id ?? null,
      requisitionCancelled: cancelRequisition,
    };
  }).catch((error: unknown) => {
    if (error instanceof WorkforcePlanningConflict) {
      return Response.json({ error: error.message, ...error.details }, { status: 409 });
    }
    throw error;
  });
  if (resultOrResponse instanceof Response) return resultOrResponse;

  await recordAuditEvent({
    organizationId: position.organizationId,
    actor: user.name,
    action: "Position status changed",
    resource: position.code,
    metadata: {
      positionId: id,
      from: resultOrResponse.fromStatus,
      to: status,
      requisitionId: resultOrResponse.requisitionId,
      requisitionCancelled: resultOrResponse.requisitionCancelled,
    },
  });
  return Response.json(resultOrResponse.updated);
}
