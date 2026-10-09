import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents,
  costCenters,
  employees,
  jobProfiles,
  legalEntities,
  orgUnits,
  positionAssignments,
  positions,
  workerEffectiveChanges,
  workerEmploymentEvents,
} from "@/db/schema";
import { effectiveHcmSourceDrift } from "@/lib/hcm-effective-source-integrity";
import { runAutomationEventSafely, runLifecycleAutomations } from "@/lib/automation";
import { runEmployeeFieldChangeAutomations } from "@/lib/automation-change-events";
import { syncEmployeeHcmObligations } from "@/lib/hcm-documents";

type ChangeSnapshot = {
  changes?: Record<string, unknown>;
  targetPositionPreviousStatus?: string | null;
  [key: string]: unknown;
};

function snapshot(value: unknown): ChangeSnapshot {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ChangeSnapshot : {};
}

function hasChange(changes: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(changes, key);
}

export function philippineBusinessDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(now);
}

export function previousIsoDate(date: string) {
  const value = new Date(date + "T00:00:00Z");
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function nullableInteger(value: unknown) {
  if (value === null) return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function nullableText(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string") return null;
  return value;
}

export async function applyWorkerEffectiveChange(
  changeId: number,
  options: { actor?: string; actorUserId?: number | null; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  const today = philippineBusinessDate(now);
  const actor = options.actor ?? "System scheduler";
  const actorUserId = options.actorUserId ?? null;

  const [existing] = await db.select().from(workerEffectiveChanges)
    .where(eq(workerEffectiveChanges.id, changeId))
    .limit(1);
  if (!existing) return { skipped: true as const, reason: "missing" };
  if (existing.status === "applied") return { skipped: true as const, reason: "already_applied", change: existing };
  if (existing.status !== "scheduled") return { skipped: true as const, reason: "not_scheduled", change: existing };
  if (String(existing.effectiveDate) > today) return { skipped: true as const, reason: "not_due", change: existing };

  let result;
  try {
    result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(4203, ${changeId})`);

      const [change] = await tx.select().from(workerEffectiveChanges)
        .where(eq(workerEffectiveChanges.id, changeId))
        .limit(1);
      if (!change || change.status !== "scheduled") {
        return { skipped: true as const, reason: "claimed" as const, change: change ?? null };
      }
      if (String(change.effectiveDate) > today) {
        return { skipped: true as const, reason: "not_due" as const, change };
      }

      await tx.execute(sql`select pg_advisory_xact_lock(4204, ${change.employeeId})`);

      const [employee] = await tx.select().from(employees).where(and(
        eq(employees.id, change.employeeId),
        eq(employees.organizationId, change.organizationId),
      )).limit(1);
      if (!employee) throw new Error("The employee no longer exists.");

      const [currentAssignment] = await tx.select().from(positionAssignments).where(and(
        eq(positionAssignments.organizationId, change.organizationId),
        eq(positionAssignments.employeeId, change.employeeId),
        eq(positionAssignments.assignmentType, "primary"),
        isNull(positionAssignments.effectiveUntil),
      )).limit(1);

      const currentPosition = currentAssignment
        ? (await tx.select().from(positions).where(and(
            eq(positions.id, currentAssignment.positionId),
            eq(positions.organizationId, change.organizationId),
          )).limit(1))[0] ?? null
        : null;

      // Source snapshots are frozen when a different People reviewer approves
      // the request. Re-check after acquiring the employee lock, *before*
      // any position or employee mutation. An older approval is not permission
      // to undo a new transfer, legal-employer update or status change.
      const sourceDrift = effectiveHcmSourceDrift(change.fromSnapshot, {
        employee,
        assignment: currentAssignment,
        position: currentPosition,
      });
      if (sourceDrift) {
        throw new Error(`${sourceDrift.code}: ${sourceDrift.message}`);
      }

      const to = snapshot(change.toSnapshot);
      const changes = to.changes && typeof to.changes === "object" && !Array.isArray(to.changes)
        ? to.changes
        : {};
      const targetPosition = change.targetPositionId
        ? (await tx.select().from(positions).where(and(
            eq(positions.id, change.targetPositionId),
            eq(positions.organizationId, change.organizationId),
          )).limit(1))[0] ?? null
        : null;

      if (change.targetPositionId && !targetPosition) {
        throw new Error("The scheduled target position no longer exists.");
      }

      if (targetPosition) {
        if (targetPosition.orgUnitId) {
          const [unit] = await tx.select({ id: orgUnits.id, type: orgUnits.type, active: orgUnits.active }).from(orgUnits).where(and(
            eq(orgUnits.id, targetPosition.orgUnitId),
            eq(orgUnits.organizationId, change.organizationId),
          )).limit(1);
          if (!unit?.active || unit.type === "supervisory") throw new Error("The target position's operating organization is no longer active.");
        }
        if (targetPosition.supervisoryOrgUnitId) {
          const [unit] = await tx.select({ id: orgUnits.id, type: orgUnits.type, active: orgUnits.active }).from(orgUnits).where(and(
            eq(orgUnits.id, targetPosition.supervisoryOrgUnitId),
            eq(orgUnits.organizationId, change.organizationId),
          )).limit(1);
          if (!unit?.active || unit.type !== "supervisory") throw new Error("The target position's supervisory organization is no longer active.");
        }
        if (targetPosition.legalEntityId) {
          const [entity] = await tx.select({ id: legalEntities.id, active: legalEntities.active }).from(legalEntities).where(and(
            eq(legalEntities.id, targetPosition.legalEntityId),
            eq(legalEntities.organizationId, change.organizationId),
          )).limit(1);
          if (!entity?.active) throw new Error("The target position's legal employer is no longer active.");
        }
        if (targetPosition.costCenterId) {
          const [center] = await tx.select({ id: costCenters.id, active: costCenters.active }).from(costCenters).where(and(
            eq(costCenters.id, targetPosition.costCenterId),
            eq(costCenters.organizationId, change.organizationId),
          )).limit(1);
          if (!center?.active) throw new Error("The target position's cost center is no longer active.");
        }
        if (targetPosition.managerEmployeeId) {
          const [manager] = await tx.select({ id: employees.id, status: employees.status }).from(employees).where(and(
            eq(employees.id, targetPosition.managerEmployeeId),
            eq(employees.organizationId, change.organizationId),
          )).limit(1);
          if (!manager || manager.status !== "Active" || manager.id === change.employeeId) {
            throw new Error("The target position's manager is no longer an eligible active manager.");
          }
        }
      } else {
        if (hasChange(changes, "orgUnitId") && changes.orgUnitId !== null) {
          const [unit] = await tx.select({ id: orgUnits.id, type: orgUnits.type, active: orgUnits.active }).from(orgUnits).where(and(
            eq(orgUnits.id, Number(changes.orgUnitId)),
            eq(orgUnits.organizationId, change.organizationId),
          )).limit(1);
          if (!unit?.active || unit.type === "supervisory") throw new Error("The scheduled operating organization is no longer active.");
        }
        if (hasChange(changes, "supervisoryOrgUnitId") && changes.supervisoryOrgUnitId !== null) {
          const [unit] = await tx.select({ id: orgUnits.id, type: orgUnits.type, active: orgUnits.active }).from(orgUnits).where(and(
            eq(orgUnits.id, Number(changes.supervisoryOrgUnitId)),
            eq(orgUnits.organizationId, change.organizationId),
          )).limit(1);
          if (!unit?.active || unit.type !== "supervisory") throw new Error("The scheduled supervisory organization is no longer active.");
        }
        if (hasChange(changes, "legalEntityId")) {
          if (changes.legalEntityId === null) throw new Error("The legal employer cannot be cleared from an active worker.");
          const [entity] = await tx.select({ id: legalEntities.id, active: legalEntities.active }).from(legalEntities).where(and(
            eq(legalEntities.id, Number(changes.legalEntityId)),
            eq(legalEntities.organizationId, change.organizationId),
          )).limit(1);
          if (!entity?.active) throw new Error("The scheduled legal employer is no longer active.");
        }
        if (hasChange(changes, "costCenterId") && changes.costCenterId !== null) {
          const [center] = await tx.select({ id: costCenters.id, active: costCenters.active }).from(costCenters).where(and(
            eq(costCenters.id, Number(changes.costCenterId)),
            eq(costCenters.organizationId, change.organizationId),
          )).limit(1);
          if (!center?.active) throw new Error("The scheduled cost center is no longer active.");
        }
        if (hasChange(changes, "managerEmployeeId") && changes.managerEmployeeId !== null) {
          const [manager] = await tx.select({ id: employees.id, status: employees.status }).from(employees).where(and(
            eq(employees.id, Number(changes.managerEmployeeId)),
            eq(employees.organizationId, change.organizationId),
          )).limit(1);
          if (!manager || manager.status !== "Active" || manager.id === change.employeeId) {
            throw new Error("The scheduled manager is no longer an eligible active manager.");
          }
        }
      }

      let nextAssignment = currentAssignment ?? null;
      let nextPosition = currentPosition;
      let nextOrgUnitId = employee.orgUnitId;
      let nextLegalEntityId = employee.legalEntityId;
      let nextEmploymentType = employee.employmentType;
      let nextStatus = employee.status;
      let nextTitle = employee.title;
      let nextManagerEmployeeId = currentPosition?.managerEmployeeId ?? null;

      if (targetPosition) {
        if (String(change.effectiveDate) < today) {
          throw new Error("Retroactive position moves are not auto-applied. Cancel and re-enter as a current/future-dated move.");
        }
        if (targetPosition.status !== "reserved") {
          throw new Error("The target position is no longer reserved for this scheduled change.");
        }

        const [incumbent] = await tx.select({ id: positionAssignments.id, employeeId: positionAssignments.employeeId })
          .from(positionAssignments)
          .where(and(
            eq(positionAssignments.positionId, targetPosition.id),
            isNull(positionAssignments.effectiveUntil),
          ))
          .limit(1);
        if (incumbent && incumbent.employeeId !== change.employeeId) {
          throw new Error("The target position was filled by another worker.");
        }
        if (currentAssignment && currentAssignment.positionId === targetPosition.id) {
          throw new Error("The employee already occupies the scheduled target position.");
        }
        if (currentAssignment && String(currentAssignment.effectiveFrom) >= String(change.effectiveDate)) {
          throw new Error("The current primary assignment does not have a completed day before this move.");
        }

        const [profile] = await tx.select().from(jobProfiles).where(and(
          eq(jobProfiles.id, targetPosition.jobProfileId),
          eq(jobProfiles.organizationId, change.organizationId),
        )).limit(1);
        if (!profile) throw new Error("The target position job profile is missing.");

        if (currentAssignment) {
          const [closedAssignment] = await tx.update(positionAssignments).set({
            effectiveUntil: previousIsoDate(String(change.effectiveDate)),
          }).where(and(
            eq(positionAssignments.id, currentAssignment.id),
            eq(positionAssignments.organizationId, change.organizationId),
            isNull(positionAssignments.effectiveUntil),
          )).returning({ id: positionAssignments.id });
          if (!closedAssignment) {
            throw new Error("The original position assignment changed during application. No HCM change was committed.");
          }
        }

        const [createdAssignment] = await tx.insert(positionAssignments).values({
          organizationId: change.organizationId,
          positionId: targetPosition.id,
          employeeId: change.employeeId,
          assignmentType: "primary",
          fte: change.targetFte ?? currentAssignment?.fte ?? "1.0000",
          effectiveFrom: String(change.effectiveDate),
          reason: change.reason,
          createdByUserId: change.approvedByUserId ?? change.requestedByUserId,
        }).returning();
        nextAssignment = createdAssignment;

        if (currentPosition) {
          await tx.update(positions).set({
            status: "open",
            updatedAt: now,
          }).where(eq(positions.id, currentPosition.id));
        }

        const [filled] = await tx.update(positions).set({
          status: "filled",
          updatedAt: now,
        }).where(and(
          eq(positions.id, targetPosition.id),
          eq(positions.status, "reserved"),
        )).returning();
        if (!filled) throw new Error("The target position reservation changed before application.");

        nextPosition = filled;
        nextOrgUnitId = targetPosition.orgUnitId;
        nextLegalEntityId = targetPosition.legalEntityId ?? employee.legalEntityId;
        nextEmploymentType = targetPosition.employmentType;
        nextTitle = profile.title;
        nextManagerEmployeeId = targetPosition.managerEmployeeId;
      } else {
        if (currentPosition) {
          const positionUpdate: Partial<typeof positions.$inferInsert> = { updatedAt: now };
          if (hasChange(changes, "orgUnitId")) positionUpdate.orgUnitId = nullableInteger(changes.orgUnitId);
          if (hasChange(changes, "supervisoryOrgUnitId")) positionUpdate.supervisoryOrgUnitId = nullableInteger(changes.supervisoryOrgUnitId);
          if (hasChange(changes, "legalEntityId")) positionUpdate.legalEntityId = nullableInteger(changes.legalEntityId);
          if (hasChange(changes, "costCenterId")) positionUpdate.costCenterId = nullableInteger(changes.costCenterId);
          if (hasChange(changes, "managerEmployeeId")) positionUpdate.managerEmployeeId = nullableInteger(changes.managerEmployeeId);
          if (hasChange(changes, "employmentType")) positionUpdate.employmentType = nullableText(changes.employmentType) ?? currentPosition.employmentType;

          const [updatedPosition] = await tx.update(positions)
            .set(positionUpdate)
            .where(and(
              eq(positions.id, currentPosition.id),
              eq(positions.organizationId, change.organizationId),
            ))
            .returning();
          nextPosition = updatedPosition ?? currentPosition;
          nextManagerEmployeeId = nextPosition.managerEmployeeId;
        } else if (
          hasChange(changes, "managerEmployeeId")
          || hasChange(changes, "supervisoryOrgUnitId")
          || hasChange(changes, "costCenterId")
        ) {
          throw new Error("Manager, supervisory-org, and cost-center changes require an authoritative current position.");
        }

        if (hasChange(changes, "orgUnitId")) nextOrgUnitId = nullableInteger(changes.orgUnitId);
        if (hasChange(changes, "legalEntityId")) nextLegalEntityId = nullableInteger(changes.legalEntityId);
        if (hasChange(changes, "employmentType")) nextEmploymentType = nullableText(changes.employmentType) ?? employee.employmentType;
        if (hasChange(changes, "employeeStatus")) nextStatus = nullableText(changes.employeeStatus) ?? employee.status;
      }

      const [updatedEmployee] = await tx.update(employees).set({
        orgUnitId: nextOrgUnitId,
        legalEntityId: nextLegalEntityId,
        employmentType: nextEmploymentType,
        status: nextStatus,
        title: nextTitle,
      }).where(and(
        eq(employees.id, change.employeeId),
        eq(employees.organizationId, change.organizationId),
        // Optimistic compare-and-swap also fences writers that do not yet
        // participate in advisory lock (4204, employeeId).
        employee.orgUnitId === null
          ? isNull(employees.orgUnitId)
          : eq(employees.orgUnitId, employee.orgUnitId),
        employee.legalEntityId === null
          ? isNull(employees.legalEntityId)
          : eq(employees.legalEntityId, employee.legalEntityId),
        eq(employees.title, employee.title),
        eq(employees.employmentType, employee.employmentType),
        eq(employees.status, employee.status),
      )).returning();
      if (!updatedEmployee) {
        throw new Error("The employee's authoritative HCM source changed before commit. No approved change was applied.");
      }

      const [event] = await tx.insert(workerEmploymentEvents).values({
        organizationId: change.organizationId,
        employeeId: change.employeeId,
        effectiveDate: String(change.effectiveDate),
        eventType: change.movementType,
        positionAssignmentId: nextAssignment?.id ?? currentAssignment?.id ?? null,
        fromPositionId: currentPosition?.id ?? null,
        toPositionId: nextPosition?.id ?? null,
        fromOrgUnitId: employee.orgUnitId,
        toOrgUnitId: updatedEmployee.orgUnitId,
        fromLegalEntityId: employee.legalEntityId,
        toLegalEntityId: updatedEmployee.legalEntityId,
        fromManagerEmployeeId: currentPosition?.managerEmployeeId ?? null,
        toManagerEmployeeId: nextManagerEmployeeId,
        fromEmploymentType: employee.employmentType,
        toEmploymentType: updatedEmployee.employmentType,
        fromStatus: employee.status,
        toStatus: updatedEmployee.status,
        reason: change.reason,
        metadata: {
          effectiveChangeId: change.id,
          changeType: change.changeType,
          requestedBy: change.requestedBy,
          approvedBy: change.approvedBy,
          targetSupervisoryOrgUnitId: nextPosition?.supervisoryOrgUnitId ?? null,
          targetCostCenterId: nextPosition?.costCenterId ?? null,
          retroactive: String(change.effectiveDate) < today,
        },
        actorUserId,
        actorName: actor,
      }).returning();

      const [applied] = await tx.update(workerEffectiveChanges).set({
        status: "applied",
        appliedAt: now,
        appliedEventId: event.id,
        failure: null,
        updatedAt: now,
      }).where(and(
        eq(workerEffectiveChanges.id, change.id),
        eq(workerEffectiveChanges.status, "scheduled"),
      )).returning();
      if (!applied) throw new Error("The scheduled change was modified before application.");

      // Financially and legally meaningful job/legal-employer transitions
      // must never commit without the actor/source audit. A failure inserting
      // this row rolls back the position, employee, event and status changes.
      const [audit] = await tx.insert(auditEvents).values({
        organizationId: change.organizationId,
        actor: actor.slice(0, 120),
        action: "Effective-dated HCM change applied",
        resource: `Employee #${change.employeeId}`,
        metadata: {
          effectiveChangeId: change.id,
          employeeId: change.employeeId,
          effectiveDate: change.effectiveDate,
          movementType: change.movementType,
          eventId: event.id,
          approvedByUserId: change.approvedByUserId,
          appliedByUserId: actorUserId,
          fromSnapshot: change.fromSnapshot,
          toSnapshot: change.toSnapshot,
          sourceGuard: "validated-before-apply",
        },
      }).returning({ id: auditEvents.id });
      if (!audit) throw new Error("HCM change audit did not persist. Application rolled back.");

      return {
        skipped: false as const,
        change: applied,
        employeeBefore: employee,
        employee: updatedEmployee,
        currentPosition,
        position: nextPosition,
        assignment: nextAssignment,
        event,
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown effective-change failure.";
    await db.update(workerEffectiveChanges).set({
      status: "failed",
      failure: message.slice(0, 4000),
      updatedAt: now,
    }).where(and(
      eq(workerEffectiveChanges.id, changeId),
      eq(workerEffectiveChanges.status, "scheduled"),
    ));
    throw error;
  }

  if (result.skipped) return result;

  // At this point the source, worker, position, history and audit have all
  // committed. Only non-financial follow-up deliveries can warn and continue.
  const postApplyWarnings: string[] = [];
  let hcmObligations: unknown = null;
  try {
    hcmObligations = await syncEmployeeHcmObligations({
      organizationId: result.change.organizationId,
      employeeId: result.change.employeeId,
    });
  } catch (error) {
    postApplyWarnings.push(`hcm-obligations: ${error instanceof Error ? error.message : "unknown failure"}`);
  }

  let lifecycleAutomation: Awaited<ReturnType<typeof runLifecycleAutomations>> = [];
  try {
    lifecycleAutomation = await runLifecycleAutomations({
      organizationId: result.change.organizationId,
      employeeId: result.change.employeeId,
      trigger: "employee.moved",
      eventKey: `effective-change:${result.change.id}`,
      context: {
        effectiveChangeId: result.change.id,
        effectiveDate: result.change.effectiveDate,
        movementType: result.change.movementType,
        previousOrgUnitId: result.employeeBefore.orgUnitId,
        orgUnitId: result.employee.orgUnitId,
        previousPositionId: result.currentPosition?.id ?? null,
        positionId: result.position?.id ?? null,
        positionCode: result.position?.code ?? null,
        employmentType: result.employee.employmentType,
        title: result.employee.title,
      },
    });
  } catch (error) {
    postApplyWarnings.push(`lifecycle-automation: ${error instanceof Error ? error.message : "unknown failure"}`);
  }

  let promotionAutomation: Awaited<ReturnType<typeof runAutomationEventSafely>> = [];
  if (result.change.movementType === "promotion") {
    try {
      promotionAutomation = await runAutomationEventSafely({
          organizationId: result.change.organizationId,
          employeeId: result.change.employeeId,
          trigger: "employee.promoted",
          eventKey: `effective-change-promotion:${result.change.id}`,
          context: {
            effectiveChangeId: result.change.id,
            effectiveDate: result.change.effectiveDate,
            previousOrgUnitId: result.employeeBefore.orgUnitId,
            orgUnitId: result.employee.orgUnitId,
            previousPositionId: result.currentPosition?.id ?? null,
            positionId: result.position?.id ?? null,
            positionCode: result.position?.code ?? null,
            title: result.employee.title,
          },
        });
    } catch (error) {
      postApplyWarnings.push(`promotion-automation: ${error instanceof Error ? error.message : "unknown failure"}`);
    }
  }

  let fieldChangeAutomation: Awaited<ReturnType<typeof runEmployeeFieldChangeAutomations>> | null = null;
  try {
    fieldChangeAutomation = await runEmployeeFieldChangeAutomations({
    organizationId: result.change.organizationId,
    employeeId: result.change.employeeId,
    eventKey: `effective-change:${result.change.id}:field-change`,
    changes: [
      {
        field: "orgUnitId",
        previousValue: result.employeeBefore.orgUnitId,
        newValue: result.employee.orgUnitId,
        effectiveDate: String(result.change.effectiveDate),
        source: "hcm-effective-change",
        metadata: { effectiveChangeId: result.change.id, movementType: result.change.movementType },
      },
      {
        field: "positionId",
        previousValue: result.currentPosition?.id ?? null,
        newValue: result.position?.id ?? null,
        effectiveDate: String(result.change.effectiveDate),
        source: "hcm-effective-change",
        metadata: { effectiveChangeId: result.change.id, movementType: result.change.movementType },
      },
      {
        field: "managerEmployeeId",
        previousValue: result.currentPosition?.managerEmployeeId ?? null,
        newValue: result.position?.managerEmployeeId ?? null,
        effectiveDate: String(result.change.effectiveDate),
        source: "hcm-effective-change",
        metadata: { effectiveChangeId: result.change.id, movementType: result.change.movementType },
      },
      {
        field: "legalEntityId",
        previousValue: result.employeeBefore.legalEntityId,
        newValue: result.employee.legalEntityId,
        effectiveDate: String(result.change.effectiveDate),
        source: "hcm-effective-change",
        metadata: { effectiveChangeId: result.change.id, movementType: result.change.movementType },
      },
      {
        field: "employmentType",
        previousValue: result.employeeBefore.employmentType,
        newValue: result.employee.employmentType,
        effectiveDate: String(result.change.effectiveDate),
        source: "hcm-effective-change",
        metadata: { effectiveChangeId: result.change.id, movementType: result.change.movementType },
      },
      {
        field: "employeeStatus",
        previousValue: result.employeeBefore.status,
        newValue: result.employee.status,
        effectiveDate: String(result.change.effectiveDate),
        source: "hcm-effective-change",
        metadata: { effectiveChangeId: result.change.id, movementType: result.change.movementType },
      },
      {
        field: "title",
        previousValue: result.employeeBefore.title,
        newValue: result.employee.title,
        effectiveDate: String(result.change.effectiveDate),
        source: "hcm-effective-change",
        metadata: { effectiveChangeId: result.change.id, movementType: result.change.movementType },
      },
      {
        field: "costCenterId",
        previousValue: result.currentPosition?.costCenterId ?? null,
        newValue: result.position?.costCenterId ?? null,
        effectiveDate: String(result.change.effectiveDate),
        source: "hcm-effective-change",
        metadata: { effectiveChangeId: result.change.id, movementType: result.change.movementType },
      },
      {
        field: "supervisoryOrgUnitId",
        previousValue: result.currentPosition?.supervisoryOrgUnitId ?? null,
        newValue: result.position?.supervisoryOrgUnitId ?? null,
        effectiveDate: String(result.change.effectiveDate),
        source: "hcm-effective-change",
        metadata: { effectiveChangeId: result.change.id, movementType: result.change.movementType },
      },
    ],
    });
  } catch (error) {
    // A downstream notification failure MUST NOT be reported as an HCM apply
    // failure after the worker/legal employer was committed and audited.
    postApplyWarnings.push(`field-change-automation: ${error instanceof Error ? error.message : "unknown failure"}`);
  }

  return {
    ...result,
    hcmObligations,
    automation: [...lifecycleAutomation, ...promotionAutomation],
    fieldChangeAutomation,
    postApplyWarnings,
  };
}

export async function runScheduledWorkerEffectiveChanges({
  actor = "System scheduler",
  now = new Date(),
  limit = 50,
}: {
  actor?: string;
  now?: Date;
  limit?: number;
} = {}) {
  const today = philippineBusinessDate(now);
  const rows = await db.select({ id: workerEffectiveChanges.id })
    .from(workerEffectiveChanges)
    .where(and(
      eq(workerEffectiveChanges.status, "scheduled"),
      lte(workerEffectiveChanges.effectiveDate, today),
    ))
    .orderBy(workerEffectiveChanges.effectiveDate, workerEffectiveChanges.id)
    .limit(Math.max(1, Math.min(limit, 100)));

  const results: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    try {
      const result = await applyWorkerEffectiveChange(row.id, { actor, now });
      results.push({
        id: row.id,
        status: result.skipped ? "skipped" : "applied",
        reason: result.skipped ? result.reason : undefined,
      });
    } catch (error) {
      results.push({
        id: row.id,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown failure",
      });
    }
  }
  return results;
}
