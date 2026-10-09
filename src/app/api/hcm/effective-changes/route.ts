import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents,
  costCenters,
  employees,
  legalEntities,
  orgUnits,
  positionAssignments,
  positions,
  workerEffectiveChanges,
  workerEmploymentEvents,
} from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { effectiveHcmSourceDrift, effectiveHcmTargetDrift } from "@/lib/hcm-effective-source-integrity";
import { applyWorkerEffectiveChange, philippineBusinessDate } from "@/lib/hcm-effective-changes";
import {
  cancelHcmBusinessProcessForSourceTx,
  findHcmBusinessProcessForSource,
  processTypeForMovement,
  startHcmBusinessProcessTx,
} from "@/lib/hcm-business-process";
import { enforceSameOriginMutation } from "@/lib/security-request";

export const dynamic = "force-dynamic";

const MOVEMENT_TYPES = [
  "job_change",
  "transfer",
  "promotion",
  "lateral",
  "manager_change",
  "org_change",
  "legal_employer_change",
  "employment_type_change",
  "status_change",
] as const;
const EMPLOYEE_STATUSES = ["Active", "On leave"] as const;

function isoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function owns(body: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(body, key);
}

async function assertCompanyWidePeople(userId: number, organizationId: number) {
  const denied = await assertOrganizationRole(
    userId,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can manage effective-dated HCM changes.",
  );
  if (denied) return { error: denied };
  const access = await getAccess(userId, organizationId);
  if (!access?.companyWide) {
    return { error: Response.json({
      error: "Scheduled effective-dated employment changes require company-wide People access.",
    }, { status: 403 }) };
  }
  return { access };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const employeeId = url.searchParams.get("employeeId") ? Number(url.searchParams.get("employeeId")) : null;
  if (!Number.isInteger(organizationId) || (employeeId !== null && !Number.isInteger(employeeId))) {
    return Response.json({ error: "A valid organizationId and optional employeeId are required." }, { status: 400 });
  }

  const gate = await assertCompanyWidePeople(user.id, organizationId);
  if ("error" in gate) return gate.error;

  const rows = await db.select().from(workerEffectiveChanges).where(
    employeeId === null
      ? eq(workerEffectiveChanges.organizationId, organizationId)
      : and(
          eq(workerEffectiveChanges.organizationId, organizationId),
          eq(workerEffectiveChanges.employeeId, employeeId),
        ),
  ).orderBy(desc(workerEffectiveChanges.effectiveDate), desc(workerEffectiveChanges.id));

  return Response.json({ changes: rows, today: philippineBusinessDate() });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const organizationId = Number(body.organizationId);
  const employeeId = Number(body.employeeId);
  const effectiveDate = String(body.effectiveDate ?? "").trim();
  const movementType = String(body.movementType ?? "job_change").trim().toLowerCase();
  const reason = String(body.reason ?? "").trim();
  if (!Number.isInteger(organizationId) || !Number.isInteger(employeeId) || !isoDate(effectiveDate) || reason.length < 3) {
    return Response.json({ error: "organizationId, employeeId, effectiveDate, and a reason are required." }, { status: 400 });
  }
  if (!MOVEMENT_TYPES.includes(movementType as (typeof MOVEMENT_TYPES)[number])) {
    return Response.json({ error: "Unsupported HCM movement type." }, { status: 400 });
  }

  const gate = await assertCompanyWidePeople(user.id, organizationId);
  if ("error" in gate) return gate.error;

  const [employee] = await db.select().from(employees).where(and(
    eq(employees.id, employeeId),
    eq(employees.organizationId, organizationId),
  )).limit(1);
  if (!employee) return Response.json({ error: "Employee not found in this workspace." }, { status: 404 });
  if (employee.status === "Separating" || employee.status === "Separated") {
    return Response.json({ error: "Use the Separation workflow for a worker already in offboarding." }, { status: 409 });
  }

  const [currentAssignment] = await db.select().from(positionAssignments).where(and(
    eq(positionAssignments.organizationId, organizationId),
    eq(positionAssignments.employeeId, employeeId),
    eq(positionAssignments.assignmentType, "primary"),
    isNull(positionAssignments.effectiveUntil),
  )).limit(1);
  const currentPosition = currentAssignment
    ? (await db.select().from(positions).where(and(
        eq(positions.id, currentAssignment.positionId),
        eq(positions.organizationId, organizationId),
      )).limit(1))[0] ?? null
    : null;

  const changes: Record<string, unknown> = {};
  const targetPositionId = owns(body, "targetPositionId") && body.targetPositionId != null && body.targetPositionId !== ""
    ? Number(body.targetPositionId)
    : null;
  const targetFte = owns(body, "targetFte") && body.targetFte != null && body.targetFte !== ""
    ? Number(body.targetFte)
    : null;

  const dimensionInputs = [
    ["orgUnitId", "targetOrgUnitId"],
    ["supervisoryOrgUnitId", "targetSupervisoryOrgUnitId"],
    ["legalEntityId", "targetLegalEntityId"],
    ["costCenterId", "targetCostCenterId"],
    ["managerEmployeeId", "targetManagerEmployeeId"],
    ["employmentType", "targetEmploymentType"],
    ["employeeStatus", "targetEmployeeStatus"],
  ] as const;
  for (const [changeKey, bodyKey] of dimensionInputs) {
    if (owns(body, bodyKey)) changes[changeKey] = body[bodyKey] === "" ? null : body[bodyKey];
  }

  if (targetPositionId !== null && !Number.isInteger(targetPositionId)) {
    return Response.json({ error: "targetPositionId must be a valid position id." }, { status: 400 });
  }
  if (targetFte !== null && (!Number.isFinite(targetFte) || targetFte <= 0 || targetFte > 1)) {
    return Response.json({ error: "targetFte must be greater than 0 and no more than 1.0." }, { status: 400 });
  }
  if (targetPositionId !== null) {
    const incompatible = ["orgUnitId", "supervisoryOrgUnitId", "legalEntityId", "costCenterId", "managerEmployeeId", "employmentType"]
      .filter((key) => owns(changes, key));
    if (incompatible.length > 0) {
      return Response.json({
        error: "A position move inherits org, supervisory org, legal employer, cost center, manager, and employment type from the target position. Do not override those dimensions in the same request.",
      }, { status: 400 });
    }
  }
  if (targetPositionId === null && Object.keys(changes).length === 0 && targetFte === null) {
    return Response.json({ error: "Select at least one employment change." }, { status: 400 });
  }
  if (targetPositionId === null && targetFte !== null) {
    return Response.json({ error: "FTE changes in HCM Core 2.2 must accompany a position move." }, { status: 400 });
  }

  const targetStatus = changes.employeeStatus;
  if (targetStatus != null && !EMPLOYEE_STATUSES.includes(String(targetStatus) as (typeof EMPLOYEE_STATUSES)[number])) {
    return Response.json({
      error: "Scheduled status changes support Active or On leave. Use the Discipline or Separation workflows for disciplinary and offboarding states.",
    }, { status: 400 });
  }
  if (changes.employmentType != null && !String(changes.employmentType).trim()) {
    return Response.json({ error: "Employment type cannot be blank." }, { status: 400 });
  }

  const today = philippineBusinessDate();
  if (effectiveDate < today && targetPositionId !== null) {
    return Response.json({
      error: "Retroactive position moves are blocked because they can rewrite assignment history. Use today or a future date for position moves.",
    }, { status: 409 });
  }

  if (effectiveDate < today) {
    const laterEvents = await db.select({ id: workerEmploymentEvents.id, effectiveDate: workerEmploymentEvents.effectiveDate })
      .from(workerEmploymentEvents)
      .where(and(
        eq(workerEmploymentEvents.organizationId, organizationId),
        eq(workerEmploymentEvents.employeeId, employeeId),
      ))
      .orderBy(desc(workerEmploymentEvents.effectiveDate), desc(workerEmploymentEvents.id));
    const later = laterEvents.find((event) => String(event.effectiveDate) > effectiveDate);
    if (later) {
      return Response.json({
        error: "A later employment event already exists. This retroactive correction would invalidate subsequent history and is blocked.",
        laterEventId: later.id,
        laterEffectiveDate: later.effectiveDate,
      }, { status: 409 });
    }
  }

  let targetPosition: typeof positions.$inferSelect | null = null;
  if (targetPositionId !== null) {
    [targetPosition] = await db.select().from(positions).where(and(
      eq(positions.id, targetPositionId),
      eq(positions.organizationId, organizationId),
    )).limit(1);
    if (!targetPosition) return Response.json({ error: "Target position not found." }, { status: 404 });
    if (targetPosition.status !== "approved") {
      return Response.json({ error: "A scheduled position move requires a vacant approved position." }, { status: 409 });
    }
    if (currentPosition?.id === targetPosition.id) {
      return Response.json({ error: "Employee already occupies the selected target position." }, { status: 409 });
    }
    const [incumbent] = await db.select({ id: positionAssignments.id }).from(positionAssignments).where(and(
      eq(positionAssignments.positionId, targetPosition.id),
      isNull(positionAssignments.effectiveUntil),
    )).limit(1);
    if (incumbent) return Response.json({ error: "The target position already has an active incumbent." }, { status: 409 });
  }

  const integerTargets: Array<[string, unknown]> = [
    ["orgUnitId", changes.orgUnitId],
    ["supervisoryOrgUnitId", changes.supervisoryOrgUnitId],
    ["legalEntityId", changes.legalEntityId],
    ["costCenterId", changes.costCenterId],
    ["managerEmployeeId", changes.managerEmployeeId],
  ];
  for (const [key, raw] of integerTargets) {
    if (!owns(changes, key) || raw === null) continue;
    const id = Number(raw);
    if (!Number.isInteger(id)) return Response.json({ error: `${key} must be a valid id or null.` }, { status: 400 });
  }

  if (owns(changes, "orgUnitId") && changes.orgUnitId !== null) {
    const [row] = await db.select().from(orgUnits).where(and(
      eq(orgUnits.id, Number(changes.orgUnitId)),
      eq(orgUnits.organizationId, organizationId),
      eq(orgUnits.active, true),
    )).limit(1);
    if (!row || row.type === "supervisory") return Response.json({ error: "targetOrgUnitId must reference an active operating organization unit." }, { status: 400 });
  }
  if (owns(changes, "supervisoryOrgUnitId") && changes.supervisoryOrgUnitId !== null) {
    const [row] = await db.select().from(orgUnits).where(and(
      eq(orgUnits.id, Number(changes.supervisoryOrgUnitId)),
      eq(orgUnits.organizationId, organizationId),
      eq(orgUnits.active, true),
    )).limit(1);
    if (!row || row.type !== "supervisory") return Response.json({ error: "targetSupervisoryOrgUnitId must reference an active supervisory organization." }, { status: 400 });
  }
  if (owns(changes, "legalEntityId")) {
    if (changes.legalEntityId === null) return Response.json({ error: "Legal employer cannot be cleared from an active worker." }, { status: 400 });
    const [row] = await db.select().from(legalEntities).where(and(
      eq(legalEntities.id, Number(changes.legalEntityId)),
      eq(legalEntities.organizationId, organizationId),
      eq(legalEntities.active, true),
    )).limit(1);
    if (!row) return Response.json({ error: "Active target legal employer not found." }, { status: 404 });
  }
  if (owns(changes, "costCenterId") && changes.costCenterId !== null) {
    const [row] = await db.select().from(costCenters).where(and(
      eq(costCenters.id, Number(changes.costCenterId)),
      eq(costCenters.organizationId, organizationId),
      eq(costCenters.active, true),
    )).limit(1);
    if (!row) return Response.json({ error: "Active target cost center not found." }, { status: 404 });
  }
  if (owns(changes, "managerEmployeeId") && changes.managerEmployeeId !== null) {
    const [row] = await db.select().from(employees).where(and(
      eq(employees.id, Number(changes.managerEmployeeId)),
      eq(employees.organizationId, organizationId),
      eq(employees.status, "Active"),
    )).limit(1);
    if (!row) return Response.json({ error: "Target manager must be an active employee in this workspace." }, { status: 404 });
    if (row.id === employeeId) return Response.json({ error: "An employee cannot be their own manager." }, { status: 400 });
  }

  const fromSnapshot = {
    employee: {
      orgUnitId: employee.orgUnitId,
      legalEntityId: employee.legalEntityId,
      title: employee.title,
      employmentType: employee.employmentType,
      status: employee.status,
    },
    assignment: currentAssignment ? {
      id: currentAssignment.id,
      positionId: currentAssignment.positionId,
      assignmentType: currentAssignment.assignmentType,
      fte: currentAssignment.fte,
      effectiveFrom: currentAssignment.effectiveFrom,
    } : null,
    position: currentPosition ? {
      id: currentPosition.id,
      code: currentPosition.code,
      orgUnitId: currentPosition.orgUnitId,
      supervisoryOrgUnitId: currentPosition.supervisoryOrgUnitId,
      legalEntityId: currentPosition.legalEntityId,
      costCenterId: currentPosition.costCenterId,
      managerEmployeeId: currentPosition.managerEmployeeId,
      employmentType: currentPosition.employmentType,
    } : null,
  };
  const toSnapshot = {
    changes,
    targetPosition: targetPosition ? {
      id: targetPosition.id,
      code: targetPosition.code,
      orgUnitId: targetPosition.orgUnitId,
      supervisoryOrgUnitId: targetPosition.supervisoryOrgUnitId,
      legalEntityId: targetPosition.legalEntityId,
      costCenterId: targetPosition.costCenterId,
      managerEmployeeId: targetPosition.managerEmployeeId,
      employmentType: targetPosition.employmentType,
    } : null,
    targetPositionPreviousStatus: targetPosition?.status ?? null,
  };

  let row: typeof workerEffectiveChanges.$inferSelect | null = null;
  let businessProcess: { id: number; definitionCode: string; definitionVersion: number; status: string } | null = null;
  try {
    const created = await db.transaction(async (tx) => {
      const [inserted] = await tx.insert(workerEffectiveChanges).values({
        organizationId,
        employeeId,
        changeType: targetPosition ? "position_change" : "employment_change",
        movementType,
        effectiveDate,
        status: "pending_approval",
        targetPositionId,
        targetOrgUnitId: owns(changes, "orgUnitId") && changes.orgUnitId !== null ? Number(changes.orgUnitId) : null,
        targetSupervisoryOrgUnitId: owns(changes, "supervisoryOrgUnitId") && changes.supervisoryOrgUnitId !== null ? Number(changes.supervisoryOrgUnitId) : null,
        targetLegalEntityId: owns(changes, "legalEntityId") && changes.legalEntityId !== null ? Number(changes.legalEntityId) : null,
        targetCostCenterId: owns(changes, "costCenterId") && changes.costCenterId !== null ? Number(changes.costCenterId) : null,
        targetManagerEmployeeId: owns(changes, "managerEmployeeId") && changes.managerEmployeeId !== null ? Number(changes.managerEmployeeId) : null,
        targetEmploymentType: owns(changes, "employmentType") && changes.employmentType !== null ? String(changes.employmentType).slice(0, 32) : null,
        targetEmployeeStatus: owns(changes, "employeeStatus") && changes.employeeStatus !== null ? String(changes.employeeStatus).slice(0, 32) : null,
        targetFte: targetFte !== null ? targetFte.toFixed(4) : null,
        reason: reason.slice(0, 240),
        fromSnapshot,
        toSnapshot,
        requestedByUserId: user.id,
        requestedBy: user.name,
      }).returning();
      if (!inserted) throw new Error("HCM change insert returned no row.");

      const supervisoryOrgUnitId = targetPosition?.supervisoryOrgUnitId
        ?? (owns(changes, "supervisoryOrgUnitId") && changes.supervisoryOrgUnitId !== null
          ? Number(changes.supervisoryOrgUnitId)
          : currentPosition?.supervisoryOrgUnitId ?? null);
      const process = await startHcmBusinessProcessTx(tx, {
        organizationId,
        processType: processTypeForMovement(movementType),
        sourceType: "worker_effective_change",
        sourceKey: String(inserted.id),
        employeeId,
        employeeLabel: `${employee.firstName} ${employee.lastName}`.trim(),
        supervisoryOrgUnitId,
        effectiveDate,
        initiatedByUserId: user.id,
        initiatedByName: user.name,
      });

      // Creation, approval-process initiation and the immutable actor audit
      // form one atomic source event. Never leave a pending HCM process without
      // the requester's reviewed source snapshot in its event trail.
      await tx.insert(auditEvents).values({
        organizationId,
        actor: user.name.slice(0, 120),
        action: "Effective-dated HCM change requested",
        resource: `Employee #${employeeId}`,
        metadata: {
          effectiveChangeId: inserted.id,
          requesterUserId: user.id,
          businessProcessInstanceId: process.id,
          employeeId,
          effectiveDate,
          movementType,
          targetPositionId,
          changes,
          fromSnapshot,
          toSnapshot,
        },
      });
      return { inserted, process };
    });
    row = created.inserted;
    businessProcess = {
      id: created.process.id,
      definitionCode: created.process.definitionCode,
      definitionVersion: created.process.definitionVersion,
      status: created.process.status,
    };
  } catch (error) {
    // Duplicate workers/target positions and configured BP policy errors are
    // expected business conflicts. A failed audit insert or database outage
    // must propagate as an error; its surrounding transaction rolled back.
    const code = error && typeof error === "object" && "code" in error
      ? String(error.code) : "";
    const message = error instanceof Error ? error.message : "";
    if (code === "23505" || /Business-process|pending\/scheduled HCM change/.test(message)) {
      return Response.json({
        error: message.startsWith("Business-process")
          ? message
          : "This worker or target position already has a pending/scheduled HCM change. Decide or cancel it before creating another.",
      }, { status: 409 });
    }
    throw error;
  }

  if (!row) return Response.json({ error: "The HCM change could not be created." }, { status: 500 });
  return Response.json({ ...row, businessProcess }, { status: 201 });
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const id = Number(body.id);
  const action = String(body.action ?? "").trim().toLowerCase();
  if (!Number.isInteger(id) || !["approve", "decline", "cancel", "retry"].includes(action)) {
    return Response.json({ error: "A valid change id and approve/decline/cancel/retry action are required." }, { status: 400 });
  }

  const [change] = await db.select().from(workerEffectiveChanges).where(eq(workerEffectiveChanges.id, id)).limit(1);
  if (!change) return Response.json({ error: "Effective-dated HCM change not found." }, { status: 404 });

  const gate = await assertCompanyWidePeople(user.id, change.organizationId);
  if ("error" in gate) return gate.error;

  const linkedBusinessProcess = await findHcmBusinessProcessForSource({
    organizationId: change.organizationId,
    sourceType: "worker_effective_change",
    sourceKey: String(change.id),
  });
  if (linkedBusinessProcess && ["approve", "decline"].includes(action)) {
    return Response.json({
      error: "This HCM change is governed by a business process. Decide the current work item from the HCM Inbox or Approvals workspace.",
      businessProcessInstanceId: linkedBusinessProcess.id,
      businessProcessStatus: linkedBusinessProcess.status,
    }, { status: 409 });
  }

  if (action === "approve") {
    if (change.status !== "pending_approval") {
      return Response.json({ error: "Only pending HCM changes can be approved." }, { status: 409 });
    }
    if (change.requestedByUserId === user.id) {
      return Response.json({
        error: "Maker-checker control: the person who requested this employment change cannot approve it.",
      }, { status: 403 });
    }

    const approved = await db.transaction(async (tx) => {
      if (change.targetPositionId) {
        const [reserved] = await tx.update(positions).set({
          status: "reserved",
          updatedAt: new Date(),
        }).where(and(
          eq(positions.id, change.targetPositionId),
          eq(positions.organizationId, change.organizationId),
          eq(positions.status, "approved"),
        )).returning();
        if (!reserved) throw new Error("TARGET_POSITION_NOT_AVAILABLE");
      }

      const [row] = await tx.update(workerEffectiveChanges).set({
        status: "scheduled",
        approvedByUserId: user.id,
        approvedBy: user.name,
        approvedAt: new Date(),
        failure: null,
        updatedAt: new Date(),
      }).where(and(
        eq(workerEffectiveChanges.id, id),
        eq(workerEffectiveChanges.status, "pending_approval"),
      )).returning();
      if (!row) throw new Error("CHANGE_DECISION_CONFLICT");
      await tx.insert(auditEvents).values({
        organizationId: row.organizationId,
        actor: user.name.slice(0, 120),
        action: "Effective-dated HCM change approved",
        resource: `Employee #${row.employeeId}`,
        metadata: {
          effectiveChangeId: row.id,
          effectiveDate: row.effectiveDate,
          movementType: row.movementType,
          requestedByUserId: row.requestedByUserId,
          approvedByUserId: user.id,
          targetPositionId: row.targetPositionId,
        },
      });
      return row;
    }).catch((error: unknown) => {
      if (error instanceof Error && error.message === "TARGET_POSITION_NOT_AVAILABLE") {
        return Response.json({ error: "The target position is no longer an approved vacancy." }, { status: 409 });
      }
      if (error instanceof Error && error.message === "CHANGE_DECISION_CONFLICT") {
        return Response.json({ error: "This HCM change was decided by another user. Refresh and review the current state." }, { status: 409 });
      }
      throw error;
    });
    if (approved instanceof Response) return approved;

    if (String(approved.effectiveDate) <= philippineBusinessDate()) {
      try {
        const applied = await applyWorkerEffectiveChange(approved.id, { actor: user.name, actorUserId: user.id });
        return Response.json({ change: approved, applied });
      } catch (error) {
        return Response.json({
          change: approved,
          error: error instanceof Error ? error.message : "The approved change could not be applied.",
        }, { status: 409 });
      }
    }

    return Response.json({ change: approved, scheduled: true });
  }

  if (action === "decline") {
    if (change.status !== "pending_approval") {
      return Response.json({ error: "Only pending HCM changes can be declined." }, { status: 409 });
    }
    const row = await db.transaction(async tx => {
      const [declined] = await tx.update(workerEffectiveChanges).set({
        status: "declined",
        approvedByUserId: user.id,
        approvedBy: user.name,
        approvedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(workerEffectiveChanges.id, id),
        eq(workerEffectiveChanges.organizationId, change.organizationId),
        eq(workerEffectiveChanges.status, "pending_approval"),
      )).returning();
      if (!declined) return null;
      await tx.insert(auditEvents).values({
        organizationId: declined.organizationId,
        actor: user.name.slice(0, 120),
        action: "Effective-dated HCM change declined",
        resource: `Employee #${declined.employeeId}`,
        metadata: {
          effectiveChangeId: declined.id,
          reviewerUserId: user.id,
          effectiveDate: declined.effectiveDate,
          movementType: declined.movementType,
          businessProcessInstanceId: linkedBusinessProcess?.id ?? null,
        },
      });
      return declined;
    });
    if (!row) return Response.json({ error: "This HCM change was already decided." }, { status: 409 });
    return Response.json({ change: row, businessProcessCancelled: linkedBusinessProcess?.status === "in_progress" });
  }

  if (action === "cancel") {
    if (!["pending_approval", "scheduled", "failed"].includes(change.status)) {
      return Response.json({ error: "Only pending, scheduled, or failed HCM changes can be cancelled." }, { status: 409 });
    }
    const to = change.toSnapshot && typeof change.toSnapshot === "object" && !Array.isArray(change.toSnapshot)
      ? change.toSnapshot as Record<string, unknown>
      : {};
    const previousPositionStatus = typeof to.targetPositionPreviousStatus === "string"
      ? to.targetPositionPreviousStatus
      : "approved";

    const row = await db.transaction(async (tx) => {
      if (linkedBusinessProcess?.status === "in_progress") {
        await cancelHcmBusinessProcessForSourceTx(tx, {
          organizationId: change.organizationId,
          sourceType: "worker_effective_change",
          sourceKey: String(change.id),
          actorUserId: user.id,
          actorName: user.name,
        });
      }

      if (change.targetPositionId && ["scheduled", "failed"].includes(change.status)) {
        await tx.update(positions).set({
          status: previousPositionStatus,
          updatedAt: new Date(),
        }).where(and(
          eq(positions.id, change.targetPositionId),
          eq(positions.organizationId, change.organizationId),
          eq(positions.status, "reserved"),
        ));
      }

      const [updated] = await tx.update(workerEffectiveChanges).set({
        status: "cancelled",
        cancelledByUserId: user.id,
        cancelledBy: user.name,
        cancelledAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(workerEffectiveChanges.id, id),
        eq(workerEffectiveChanges.organizationId, change.organizationId),
        eq(workerEffectiveChanges.status, change.status),
      )).returning();
      if (!updated) throw new Error("HCM_CHANGE_CANCEL_STALE");
      await tx.insert(auditEvents).values({
        organizationId: updated.organizationId,
        actor: user.name.slice(0, 120),
        action: "Effective-dated HCM change cancelled",
        resource: `Employee #${updated.employeeId}`,
        metadata: {
          effectiveChangeId: updated.id,
          cancelledByUserId: user.id,
          effectiveDate: updated.effectiveDate,
          movementType: updated.movementType,
          previousStatus: change.status,
          targetPositionId: updated.targetPositionId,
          businessProcessInstanceId: linkedBusinessProcess?.id ?? null,
        },
      });
      return updated;
    }).catch((error: unknown) => {
      if (error instanceof Error && error.message === "HCM_CHANGE_CANCEL_STALE") return null;
      throw error;
    });
    if (!row) return Response.json({ error: "This HCM change changed before cancellation." }, { status: 409 });
    return Response.json({ change: row });
  }

  if (change.status !== "failed") {
    return Response.json({ error: "Only failed HCM changes can be retried." }, { status: 409 });
  }
  if (!change.requestedByUserId || !change.approvedByUserId
    || change.requestedByUserId === change.approvedByUserId) {
    return Response.json({
      code: "HCM_RETRY_APPROVAL_EVIDENCE_MISSING",
      error: "This failed HCM change lacks a valid independent requester/approver trail. Cancel and submit a fresh change for review.",
    }, { status: 409 });
  }
  if (linkedBusinessProcess
    && !["approved", "applied"].includes(linkedBusinessProcess.status)) {
    return Response.json({
      code: "HCM_RETRY_BP_NOT_APPROVED",
      error: "The linked HCM business process is not approved. It cannot authorize a retry.",
    }, { status: 409 });
  }

  const [sourceEmployee] = await db.select().from(employees).where(and(
    eq(employees.id, change.employeeId),
    eq(employees.organizationId, change.organizationId),
  )).limit(1);
  if (!sourceEmployee) {
    return Response.json({
      code: "HCM_RETRY_EMPLOYEE_MISSING",
      error: "The worker no longer exists in the approved company; cancel this failed change.",
    }, { status: 409 });
  }

  const [sourceAssignment] = await db.select().from(positionAssignments).where(and(
    eq(positionAssignments.organizationId, change.organizationId),
    eq(positionAssignments.employeeId, change.employeeId),
    eq(positionAssignments.assignmentType, "primary"),
    isNull(positionAssignments.effectiveUntil),
  )).limit(1);
  const sourcePosition = sourceAssignment
    ? (await db.select().from(positions).where(and(
        eq(positions.id, sourceAssignment.positionId),
        eq(positions.organizationId, change.organizationId),
      )).limit(1))[0] ?? null
    : null;
  const sourceDrift = effectiveHcmSourceDrift(change.fromSnapshot, {
    employee: sourceEmployee,
    assignment: sourceAssignment ?? null,
    position: sourcePosition,
  });
  if (sourceDrift) {
    return Response.json({
      code: sourceDrift.code,
      field: sourceDrift.field,
      error: sourceDrift.message,
      nextAction: "Cancel the stale change and request a fresh independent HCM approval.",
    }, { status: 409 });
  }

  const targetPositionForRetry = change.targetPositionId
    ? (await db.select().from(positions).where(and(
        eq(positions.id, change.targetPositionId),
        eq(positions.organizationId, change.organizationId),
      )).limit(1))[0] ?? null
    : null;
  const targetDrift = effectiveHcmTargetDrift(change.toSnapshot, targetPositionForRetry);
  if (targetDrift) {
    return Response.json({
      code: targetDrift.code,
      field: targetDrift.field,
      error: targetDrift.message,
      nextAction: "Cancel the stale change and obtain a new approved destination/position.",
    }, { status: 409 });
  }

  let retried: typeof workerEffectiveChanges.$inferSelect | null = null;
  try {
    retried = await db.transaction(async tx => {
      // Retry and decision audit must be a single operation. Two operators
      // racing to retry cannot both revive the same failed source.
      await tx.execute(sql`
        SELECT id FROM worker_effective_changes
        WHERE id = ${id} AND organization_id = ${change.organizationId}
        FOR UPDATE
      `);
      const [freshChange] = await tx.select().from(workerEffectiveChanges).where(and(
        eq(workerEffectiveChanges.id, id),
        eq(workerEffectiveChanges.organizationId, change.organizationId),
      )).limit(1);
      if (!freshChange || freshChange.status !== "failed") {
        throw new Error("HCM_RETRY_DECISION_STALE");
      }
      if (!freshChange.requestedByUserId || !freshChange.approvedByUserId
        || freshChange.requestedByUserId === freshChange.approvedByUserId
        || JSON.stringify(freshChange.fromSnapshot) !== JSON.stringify(change.fromSnapshot)) {
        throw new Error("HCM_RETRY_DECISION_STALE");
      }
      if (freshChange.targetPositionId) {
        const [target] = await tx.select({ status: positions.status }).from(positions).where(and(
          eq(positions.id, freshChange.targetPositionId),
          eq(positions.organizationId, freshChange.organizationId),
        )).limit(1);
        if (target?.status !== "reserved") {
          throw new Error("HCM_RETRY_TARGET_NOT_RESERVED");
        }
      }
      const [revived] = await tx.update(workerEffectiveChanges).set({
        status: "scheduled",
        failure: null,
        updatedAt: new Date(),
      }).where(and(
        eq(workerEffectiveChanges.id, id),
        eq(workerEffectiveChanges.organizationId, change.organizationId),
        eq(workerEffectiveChanges.status, "failed"),
      )).returning();
      if (!revived) throw new Error("HCM_RETRY_DECISION_STALE");

      await tx.insert(auditEvents).values({
        organizationId: revived.organizationId,
        actor: user.name.slice(0, 120),
        action: "Effective-dated HCM change retried",
        resource: `Employee #${revived.employeeId}`,
        metadata: {
          effectiveChangeId: revived.id,
          effectiveDate: revived.effectiveDate,
          movementType: revived.movementType,
          requesterUserId: revived.requestedByUserId,
          originalApproverUserId: revived.approvedByUserId,
          retriedByUserId: user.id,
          sourceFingerprintValidated: true,
          businessProcessInstanceId: linkedBusinessProcess?.id ?? null,
        },
      });
      return revived;
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (["HCM_RETRY_DECISION_STALE", "HCM_RETRY_TARGET_NOT_RESERVED"].includes(code)) {
      return Response.json({
        code,
        error: code === "HCM_RETRY_TARGET_NOT_RESERVED"
          ? "The approved target position reservation changed. Cancel and request a fresh reviewed movement."
          : "The HCM approval changed during retry. Refresh and review the latest state.",
      }, { status: 409 });
    }
    throw error;
  }
  if (!retried) {
    return Response.json({ error: "Failed HCM change could not be rescheduled." }, { status: 409 });
  }

  if (String(retried.effectiveDate) <= philippineBusinessDate()) {
    try {
      const applied = await applyWorkerEffectiveChange(retried.id, { actor: user.name, actorUserId: user.id });
      return Response.json({ change: retried, applied });
    } catch (error) {
      return Response.json({
        change: retried,
        error: error instanceof Error ? error.message : "The retried change could not be applied.",
      }, { status: 409 });
    }
  }

  return Response.json({ change: retried, scheduled: true });
}
