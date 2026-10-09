import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, like, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents,
  costCenters,
  employees,
  jobFamilies,
  jobGrades,
  jobLevels,
  jobProfiles,
  jobRequisitions,
  hcmBusinessProcessInstances,
  legalEntities,
  orgUnits,
  positionAssignments,
  positions,
  shiftDefinitions,
  workforcePlans,
  worksites,
  workerEffectiveChanges,
  workerEmploymentEvents,
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
import { startHcmBusinessProcessTx } from "@/lib/hcm-business-process";
import { freezeHcmPositionSource } from "@/lib/hcm-position-business-process";
import {
  directPositionAssignmentGovernanceQuery,
  HCM_GOVERNED_POSITION_ASSIGNMENT_REQUIRED,
  isGovernedPositionAssignmentWorkspace,
} from "@/lib/hcm-position-assignment-guard";

export const dynamic = "force-dynamic";

const POSITION_STATUSES = ["planned", "approved", "open", "filled", "frozen", "closed"] as const;
const ORG_UNIT_TYPES = ["company", "business_unit", "division", "department", "team", "supervisory"] as const;

class WorkforcePlanningConflict extends Error {
  constructor(message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = "WorkforcePlanningConflict";
  }
}

function isoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function todayPh() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
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

  const [profiles, families, levels, grades, plans, allPositions, assignments, units, entityRows, costCenterRows, staff, requisitions, siteRows, shiftRows] = await Promise.all([
    db.select().from(jobProfiles).where(eq(jobProfiles.organizationId, organizationId)).orderBy(jobProfiles.title),
    db.select().from(jobFamilies).where(eq(jobFamilies.organizationId, organizationId)).orderBy(jobFamilies.name),
    db.select().from(jobLevels).where(eq(jobLevels.organizationId, organizationId)).orderBy(jobLevels.sequence, jobLevels.name),
    db.select().from(jobGrades).where(eq(jobGrades.organizationId, organizationId)).orderBy(jobGrades.sequence, jobGrades.name),
    db.select().from(workforcePlans).where(eq(workforcePlans.organizationId, organizationId)).orderBy(desc(workforcePlans.startDate)),
    db.select().from(positions).where(eq(positions.organizationId, organizationId)).orderBy(desc(positions.id)),
    db.select().from(positionAssignments).where(eq(positionAssignments.organizationId, organizationId)).orderBy(desc(positionAssignments.effectiveFrom)),
    db.select().from(orgUnits).where(eq(orgUnits.organizationId, organizationId)).orderBy(orgUnits.name),
    db.select().from(legalEntities).where(eq(legalEntities.organizationId, organizationId)).orderBy(legalEntities.displayName),
    db.select().from(costCenters).where(eq(costCenters.organizationId, organizationId)).orderBy(costCenters.name),
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
    db.select().from(worksites)
      .where(eq(worksites.organizationId, organizationId))
      .orderBy(worksites.name),
    db.select().from(shiftDefinitions)
      .where(and(eq(shiftDefinitions.organizationId, organizationId), eq(shiftDefinitions.active, true)))
      .orderBy(shiftDefinitions.code),
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
    jobFamilies: families,
    jobLevels: levels,
    jobGrades: grades,
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
    legalEntities: access.companyWide ? entityRows : [],
    costCenters: access.companyWide ? costCenterRows : [],
    worksites: access.companyWide
      ? siteRows
      : siteRows.filter((site) => site.orgUnitId === access.orgUnitId),
    shifts: shiftRows,
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

  if (["job_family", "job_level", "job_grade", "org_unit"].includes(entityType)) {
    const adminDenied = await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES);
    if (adminDenied) return adminDenied;
    const access = await getAccess(user.id, organizationId);
    if (!access?.companyWide) {
      return Response.json({ error: "Organization and job architecture require company-wide People access." }, { status: 403 });
    }

    if (entityType === "job_family") {
      const code = String(body.code ?? "").trim().toUpperCase();
      const name = String(body.name ?? "").trim();
      if (!code || !name) return Response.json({ error: "Family code and name are required." }, { status: 400 });
      try {
        const [row] = await db.insert(jobFamilies).values({
          organizationId,
          code: code.slice(0, 40),
          name: name.slice(0, 120),
          description: body.description ? String(body.description).trim().slice(0, 2000) : null,
        }).returning();
        await recordAuditEvent({ organizationId, actor: user.name, action: "Job family created", resource: row.name, metadata: { jobFamilyId: row.id, code: row.code } });
        return Response.json(row, { status: 201 });
      } catch {
        return Response.json({ error: "A job family with that code or name already exists." }, { status: 409 });
      }
    }

    if (entityType === "job_level") {
      const code = String(body.code ?? "").trim().toUpperCase();
      const name = String(body.name ?? "").trim();
      const sequence = Number(body.sequence ?? 0);
      if (!code || !name || !Number.isInteger(sequence) || sequence < 0) {
        return Response.json({ error: "Level code, name, and a non-negative sequence are required." }, { status: 400 });
      }
      try {
        const [row] = await db.insert(jobLevels).values({
          organizationId,
          code: code.slice(0, 40),
          name: name.slice(0, 80),
          sequence,
          description: body.description ? String(body.description).trim().slice(0, 2000) : null,
        }).returning();
        await recordAuditEvent({ organizationId, actor: user.name, action: "Job level created", resource: row.name, metadata: { jobLevelId: row.id, code: row.code, sequence } });
        return Response.json(row, { status: 201 });
      } catch {
        return Response.json({ error: "A job level with that code or name already exists." }, { status: 409 });
      }
    }

    if (entityType === "job_grade") {
      const code = String(body.code ?? "").trim().toUpperCase();
      const name = String(body.name ?? "").trim();
      const sequence = Number(body.sequence ?? 0);
      if (!code || !name || !Number.isInteger(sequence) || sequence < 0) {
        return Response.json({ error: "Grade code, name, and a non-negative sequence are required." }, { status: 400 });
      }
      try {
        const [row] = await db.insert(jobGrades).values({
          organizationId,
          code: code.slice(0, 40),
          name: name.slice(0, 80),
          sequence,
          description: body.description ? String(body.description).trim().slice(0, 2000) : null,
        }).returning();
        await recordAuditEvent({ organizationId, actor: user.name, action: "Job grade created", resource: row.name, metadata: { jobGradeId: row.id, code: row.code, sequence } });
        return Response.json(row, { status: 201 });
      } catch {
        return Response.json({ error: "A job grade with that code or name already exists." }, { status: 409 });
      }
    }

    const code = String(body.code ?? "").trim().toUpperCase();
    const name = String(body.name ?? "").trim();
    const type = String(body.type ?? "department").trim().toLowerCase();
    const parentId = body.parentId ? Number(body.parentId) : null;
    const legalEntityId = body.legalEntityId ? Number(body.legalEntityId) : null;
    const costCenterId = body.costCenterId ? Number(body.costCenterId) : null;
    const managerEmployeeId = body.managerEmployeeId ? Number(body.managerEmployeeId) : null;
    const effectiveFrom = body.effectiveFrom ? String(body.effectiveFrom) : null;
    if (!code || !name || !ORG_UNIT_TYPES.includes(type as (typeof ORG_UNIT_TYPES)[number])) {
      return Response.json({ error: "Organization-unit code, name, and a supported type are required." }, { status: 400 });
    }
    if (effectiveFrom && !isoDate(effectiveFrom)) {
      return Response.json({ error: "effectiveFrom must use YYYY-MM-DD." }, { status: 400 });
    }

    const [parent, entity, center, manager] = await Promise.all([
      parentId ? db.select({ id: orgUnits.id }).from(orgUnits).where(and(eq(orgUnits.id, parentId), eq(orgUnits.organizationId, organizationId))).limit(1) : Promise.resolve([]),
      legalEntityId ? db.select({ id: legalEntities.id }).from(legalEntities).where(and(eq(legalEntities.id, legalEntityId), eq(legalEntities.organizationId, organizationId), eq(legalEntities.active, true))).limit(1) : Promise.resolve([]),
      costCenterId ? db.select({ id: costCenters.id }).from(costCenters).where(and(eq(costCenters.id, costCenterId), eq(costCenters.organizationId, organizationId), eq(costCenters.active, true))).limit(1) : Promise.resolve([]),
      managerEmployeeId ? db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, managerEmployeeId), eq(employees.organizationId, organizationId))).limit(1) : Promise.resolve([]),
    ]);
    if (parentId && !parent[0]) return Response.json({ error: "Parent organization unit not found." }, { status: 404 });
    if (legalEntityId && !entity[0]) return Response.json({ error: "Active legal employer not found." }, { status: 404 });
    if (costCenterId && !center[0]) return Response.json({ error: "Active cost center not found." }, { status: 404 });
    if (managerEmployeeId && !manager[0]) return Response.json({ error: "Manager employee not found." }, { status: 404 });

    try {
      const [row] = await db.insert(orgUnits).values({
        organizationId,
        parentId,
        type: type.slice(0, 32),
        name: name.slice(0, 120),
        code: code.slice(0, 32),
        legalEntityId,
        costCenterId,
        managerEmployeeId,
        effectiveFrom,
        active: true,
      }).returning();
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Organization unit created",
        resource: row.name,
        metadata: { orgUnitId: row.id, code: row.code, type: row.type, parentId, legalEntityId, costCenterId, managerEmployeeId, effectiveFrom },
      });
      return Response.json(row, { status: 201 });
    } catch {
      return Response.json({ error: "An organization unit with that code already exists." }, { status: 409 });
    }
  }

  if (entityType === "profile") {
    const adminDenied = await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES);
    if (adminDenied) return adminDenied;
    const access = await getAccess(user.id, organizationId);
    if (!access?.companyWide) return Response.json({ error: "Job architecture requires company-wide access." }, { status: 403 });

    const title = String(body.title ?? "").trim();
    const familyId = Number(body.familyId);
    const levelId = Number(body.levelId);
    const gradeId = body.gradeId ? Number(body.gradeId) : null;
    if (!title || !Number.isInteger(familyId) || !Number.isInteger(levelId) || (gradeId !== null && !Number.isInteger(gradeId))) {
      return Response.json({ error: "Job title, family, and level are required; grade is optional." }, { status: 400 });
    }

    const [[family], [level], gradeRows] = await Promise.all([
      db.select().from(jobFamilies).where(and(eq(jobFamilies.id, familyId), eq(jobFamilies.organizationId, organizationId), eq(jobFamilies.active, true))).limit(1),
      db.select().from(jobLevels).where(and(eq(jobLevels.id, levelId), eq(jobLevels.organizationId, organizationId), eq(jobLevels.active, true))).limit(1),
      gradeId
        ? db.select().from(jobGrades).where(and(eq(jobGrades.id, gradeId), eq(jobGrades.organizationId, organizationId), eq(jobGrades.active, true))).limit(1)
        : Promise.resolve([]),
    ]);
    const grade = gradeRows[0] ?? null;
    if (!family) return Response.json({ error: "Active job family not found." }, { status: 404 });
    if (!level) return Response.json({ error: "Active job level not found." }, { status: 404 });
    if (gradeId && !grade) return Response.json({ error: "Active job grade not found." }, { status: 404 });

    try {
      const [row] = await db.insert(jobProfiles).values({
        organizationId,
        title: title.slice(0, 160),
        familyId: family.id,
        levelId: level.id,
        gradeId: grade?.id ?? null,
        family: family.name,
        level: level.name,
        grade: grade?.name ?? null,
        description: body.description ? String(body.description).slice(0, 4000) : null,
      }).returning();
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Job profile created",
        resource: row.title,
        metadata: { jobProfileId: row.id, familyId: row.familyId, levelId: row.levelId, gradeId: row.gradeId, family: row.family, level: row.level, grade: row.grade },
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
    const supervisoryOrgUnitId = body.supervisoryOrgUnitId ? Number(body.supervisoryOrgUnitId) : null;
    const legalEntityId = body.legalEntityId ? Number(body.legalEntityId) : null;
    const costCenterId = body.costCenterId ? Number(body.costCenterId) : null;
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
    const peopleDenied = await assertOrganizationRole(
      user.id, organizationId, PEOPLE_ADMIN_ROLES,
      "Creating governed positions requires People administration access.",
    );
    if (peopleDenied) return peopleDenied;
    if (!unitScope.access.companyWide) {
      return Response.json({ error: "Creating governed positions requires company-wide People access." }, { status: 403 });
    }

    const [profile] = await db.select({ id: jobProfiles.id }).from(jobProfiles)
      .where(and(eq(jobProfiles.id, jobProfileId), eq(jobProfiles.organizationId, organizationId))).limit(1);
    if (!profile) return Response.json({ error: "Job profile not found in this workspace." }, { status: 404 });

    if (orgUnitId) {
      const [unit] = await db.select({ id: orgUnits.id, active: orgUnits.active }).from(orgUnits)
        .where(and(eq(orgUnits.id, orgUnitId), eq(orgUnits.organizationId, organizationId))).limit(1);
      if (!unit?.active) return Response.json({ error: "Active organization unit not found in this workspace." }, { status: 404 });
    }
    if (supervisoryOrgUnitId) {
      const [supervisory] = await db.select({ id: orgUnits.id, type: orgUnits.type, active: orgUnits.active }).from(orgUnits)
        .where(and(eq(orgUnits.id, supervisoryOrgUnitId), eq(orgUnits.organizationId, organizationId))).limit(1);
      if (!supervisory?.active || supervisory.type !== "supervisory") {
        return Response.json({ error: "supervisoryOrgUnitId must reference an active supervisory organization." }, { status: 400 });
      }
    }
    if (legalEntityId) {
      const [entity] = await db.select({ id: legalEntities.id }).from(legalEntities)
        .where(and(eq(legalEntities.id, legalEntityId), eq(legalEntities.organizationId, organizationId), eq(legalEntities.active, true))).limit(1);
      if (!entity) return Response.json({ error: "Active legal employer not found in this workspace." }, { status: 404 });
    }
    if (costCenterId) {
      const [center] = await db.select({ id: costCenters.id }).from(costCenters)
        .where(and(eq(costCenters.id, costCenterId), eq(costCenters.organizationId, organizationId), eq(costCenters.active, true))).limit(1);
      if (!center) return Response.json({ error: "Active cost center not found in this workspace." }, { status: 404 });
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
      const { row, businessProcess } = await db.transaction(async (tx) => {
        const [row] = await tx.insert(positions).values({
        organizationId,
        code: code.slice(0, 48),
        jobProfileId,
        orgUnitId,
        supervisoryOrgUnitId,
        legalEntityId,
        costCenterId,
        planId,
        managerEmployeeId,
        employmentType: body.employmentType ? String(body.employmentType).slice(0, 32) : "Regular",
        status: "planned",
        plannedStartDate,
        annualBudget: annualBudget.toFixed(2),
        notes: body.notes ? String(body.notes).slice(0, 4000) : null,
        createdByUserId: user.id,
      }).returning();
        const businessProcess = await startHcmBusinessProcessTx(tx, {
          organizationId,
          processType: "create_position",
          sourceType: "position_creation",
          sourceKey: `${row.id}:${randomUUID()}`,
          employeeLabel: `Position ${row.code}`,
          supervisoryOrgUnitId: row.supervisoryOrgUnitId,
          effectiveDate: todayPh(),
          initiatedByUserId: user.id,
          initiatedByName: user.name,
          sourceEvidence: { ...freezeHcmPositionSource(row) },
        });
        return { row, businessProcess };
      });
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Position creation submitted to HCM business process",
        resource: row.code,
        metadata: {
          positionId: row.id, jobProfileId, orgUnitId, supervisoryOrgUnitId,
          legalEntityId, costCenterId, planId, annualBudget,
          businessProcessInstanceId: businessProcess.id,
        },
      });
      return Response.json({
        ...row,
        approvalRequired: true,
        businessProcess: {
          id: businessProcess.id,
          status: businessProcess.status,
          definitionCode: businessProcess.definitionCode,
        },
      }, { status: 201 });
    } catch (error) {
      return Response.json({
        error: error instanceof Error && /business-process|Business-process|Business process|duplicate key/i.test(error.message)
          ? error.message : "Position creation could not be submitted. Refresh and verify the position code and approval policy.",
      }, { status: 409 });
    }
  }

  if (entityType === "assignment") {
    const positionId = Number(body.positionId);
    const employeeId = Number(body.employeeId);
    const effectiveFrom = String(body.effectiveFrom ?? "");
    if (!Number.isInteger(positionId) || !Number.isInteger(employeeId) || !isoDate(effectiveFrom)) {
      return Response.json({ error: "positionId, employeeId, and effectiveFrom are required." }, { status: 400 });
    }
    if (effectiveFrom !== todayPh()) {
      return Response.json({
        error: "Direct assignment changes current worker state and must use the current Philippine business date. Future or retroactive assignments belong in the scheduled effective-dated HCM workflow.",
      }, { status: 409 });
    }

    const peopleDenied = await assertOrganizationRole(
      user.id, organizationId, PEOPLE_ADMIN_ROLES,
      "Direct position assignment requires People administration rights.",
    );
    if (peopleDenied) return peopleDenied;
    const companyAccess = await getAccess(user.id, organizationId);
    if (!companyAccess?.companyWide) {
      return Response.json({
        error: "Direct position assignment requires company-wide People administration. Use governed job changes for departmental decisions.",
        code: "HCM_DIRECT_ASSIGNMENT_SCOPE_REQUIRED",
      }, { status: 403 });
    }
    const mfaDenied = requireSensitiveActionMfa(user);
    if (mfaDenied) return mfaDenied;
    const rateDenied = await enforceSensitiveActionRateLimit(request, {
      userId: user.id,
      action: "hcm-manual-position-assignment",
      resourceId: `${employeeId}:${positionId}`,
      limit: 5,
      windowMs: 15 * 60_000,
    });
    if (rateDenied) return rateDenied;

    if (await isGovernedPositionAssignmentWorkspace(organizationId)) {
      return Response.json(HCM_GOVERNED_POSITION_ASSIGNMENT_REQUIRED, { status: 409 });
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

    const [employee] = await db.select({
      id: employees.id,
      orgUnitId: employees.orgUnitId,
      legalEntityId: employees.legalEntityId,
      employmentType: employees.employmentType,
      status: employees.status,
      title: employees.title,
    }).from(employees)
      .where(and(eq(employees.id, employeeId), eq(employees.organizationId, organizationId))).limit(1);
    if (!employee) return Response.json({ error: "Employee not found in this workspace." }, { status: 404 });
    if (employee.status !== "Active") {
      return Response.json({ error: "Only active employees can receive a new primary position assignment." }, { status: 409 });
    }
    const [unresolvedEffectiveChange] = await db.select({ id: workerEffectiveChanges.id, status: workerEffectiveChanges.status })
      .from(workerEffectiveChanges)
      .where(and(
        eq(workerEffectiveChanges.organizationId, organizationId),
        eq(workerEffectiveChanges.employeeId, employeeId),
        inArray(workerEffectiveChanges.status, ["pending_approval", "scheduled", "failed"]),
      ))
      .limit(1);
    if (unresolvedEffectiveChange) {
      return Response.json({
        error: "This employee has an unresolved effective-dated HCM change. Cancel or resolve it before direct position assignment.",
        effectiveChangeId: unresolvedEffectiveChange.id,
        effectiveChangeStatus: unresolvedEffectiveChange.status,
      }, { status: 409 });
    }
    const employeeScope = assertScope(companyAccess, employee.orgUnitId);
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

      const [existingPrimary] = await tx.select({ id: positionAssignments.id }).from(positionAssignments)
        .where(and(
          eq(positionAssignments.organizationId, organizationId),
          eq(positionAssignments.employeeId, employeeId),
          eq(positionAssignments.assignmentType, "primary"),
          isNull(positionAssignments.effectiveUntil),
        )).limit(1);
      if (existingPrimary) {
        throw new WorkforcePlanningConflict("This employee already has an active primary position. Use the transfer/promotion workflow instead.");
      }

      const [profile] = await tx.select({ title: jobProfiles.title }).from(jobProfiles)
        .where(and(eq(jobProfiles.id, position.jobProfileId), eq(jobProfiles.organizationId, organizationId)))
        .limit(1);
      if (!profile) throw new WorkforcePlanningConflict("The position job profile is missing.");

      const [assignment] = await tx.insert(positionAssignments).values({
        organizationId,
        positionId,
        employeeId,
        assignmentType: "primary",
        fte: "1.0000",
        effectiveFrom,
        reason: body.reason ? String(body.reason).slice(0, 240) : "Position assignment",
        createdByUserId: user.id,
      }).returning();

      await tx.update(positions)
        .set({ status: "filled", updatedAt: new Date() })
        .where(eq(positions.id, positionId));

      const [updatedEmployee] = await tx.update(employees).set({
        orgUnitId: position.orgUnitId,
        legalEntityId: position.legalEntityId ?? employee.legalEntityId,
        title: profile.title,
        employmentType: position.employmentType,
      }).where(and(eq(employees.id, employeeId), eq(employees.organizationId, organizationId))).returning();

      await tx.insert(workerEmploymentEvents).values({
        organizationId,
        employeeId,
        effectiveDate: effectiveFrom,
        eventType: "position_assigned",
        positionAssignmentId: assignment.id,
        toPositionId: position.id,
        fromOrgUnitId: employee.orgUnitId,
        toOrgUnitId: position.orgUnitId,
        fromLegalEntityId: employee.legalEntityId,
        toLegalEntityId: updatedEmployee.legalEntityId,
        toManagerEmployeeId: position.managerEmployeeId,
        fromEmploymentType: employee.employmentType,
        toEmploymentType: updatedEmployee.employmentType,
        fromStatus: employee.status,
        toStatus: updatedEmployee.status,
        reason: assignment.reason,
        metadata: {
          positionCode: position.code,
          supervisoryOrgUnitId: position.supervisoryOrgUnitId,
          costCenterId: position.costCenterId,
          fte: 1,
          source: "planning",
        },
        actorUserId: user.id,
        actorName: user.name,
      });

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

  return Response.json({ error: "entityType must be job_family, job_level, job_grade, org_unit, profile, plan, position, or assignment." }, { status: 400 });
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

  const governedAction = status === "approved" && position.status === "planned"
    ? "create_position" : status === "closed" && position.status !== "closed"
      ? "close_position" : null;
  if (governedAction) {
    const peopleDenied = await assertOrganizationRole(
      user.id, position.organizationId, PEOPLE_ADMIN_ROLES,
      "Position approval and closure require People administration access.",
    );
    if (peopleDenied) return peopleDenied;
    if (!unitScope.access.companyWide) {
      return Response.json({ error: "Position lifecycle approval requires company-wide People access." }, { status: 403 });
    }
  }

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
      .where(and(
        eq(positionAssignments.organizationId, position.organizationId),
        eq(positionAssignments.positionId, id),
        isNull(positionAssignments.effectiveUntil),
      )).limit(1);

    if (governedAction) {
      // No status, recruitment or occupancy changes happen before the final
      // independent business-process approval. Competing submissions serialize
      // on the same position lock as Recruitment / incumbent assignment.
      if (freshPosition.status !== position.status) {
        throw new WorkforcePlanningConflict("Position changed before the HCM approval could be initiated.");
      }
      if (governedAction === "close_position"
        && !["planned", "approved", "open", "frozen"].includes(freshPosition.status)) {
        throw new WorkforcePlanningConflict("A filled position must be vacated before closing it.");
      }
      if (activeAssignment) {
        throw new WorkforcePlanningConflict("End the active position assignment before requesting this status change.");
      }
      if (activeRequisition) {
        throw new WorkforcePlanningConflict(
          "Cancel or finish the active requisition before requesting position approval or closure.",
          { requisitionId: activeRequisition.id },
        );
      }
      const [current] = await tx.select().from(positions).where(and(
        eq(positions.id, position.id),
        eq(positions.organizationId, position.organizationId),
      )).limit(1);
      if (!current) throw new WorkforcePlanningConflict("Position no longer exists.");

      const [existing] = await tx.select().from(hcmBusinessProcessInstances).where(and(
        eq(hcmBusinessProcessInstances.organizationId, position.organizationId),
        inArray(hcmBusinessProcessInstances.sourceType, ["position_creation", "position_closure"]),
        like(hcmBusinessProcessInstances.sourceKey, `${position.id}:%`),
        inArray(hcmBusinessProcessInstances.status, ["in_progress", "approved"]),
      )).orderBy(desc(hcmBusinessProcessInstances.id)).limit(1);
      if (existing && existing.processType !== governedAction) {
        throw new WorkforcePlanningConflict(
          "Another position lifecycle approval is already in progress.",
          { businessProcessInstanceId: existing.id },
        );
      }
      const businessProcess = existing ?? await startHcmBusinessProcessTx(tx, {
        organizationId: position.organizationId,
        processType: governedAction,
        sourceType: governedAction === "create_position" ? "position_creation" : "position_closure",
        sourceKey: `${position.id}:${randomUUID()}`,
        employeeLabel: `Position ${position.code}`,
        supervisoryOrgUnitId: current.supervisoryOrgUnitId,
        effectiveDate: todayPh(),
        initiatedByUserId: user.id,
        initiatedByName: user.name,
        sourceEvidence: { ...freezeHcmPositionSource(current) },
      });
      return {
        approvalRequired: true as const,
        updated: current,
        businessProcess,
      };
    }

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
      approvalRequired: false as const,
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
  if (resultOrResponse.approvalRequired) {
    await recordAuditEvent({
      organizationId: position.organizationId,
      actor: user.name,
      action: "Position lifecycle review requested",
      resource: position.code,
      metadata: {
        positionId: position.id,
        requestedStatus: status,
        businessProcessInstanceId: resultOrResponse.businessProcess.id,
      },
    });
    return Response.json({
      ...resultOrResponse.updated,
      approvalRequired: true,
      businessProcess: {
        id: resultOrResponse.businessProcess.id,
        status: resultOrResponse.businessProcess.status,
        definitionCode: resultOrResponse.businessProcess.definitionCode,
      },
    }, { status: 202 });
  }

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
