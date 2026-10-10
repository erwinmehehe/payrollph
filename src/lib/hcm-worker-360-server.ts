import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { employees, positionAssignments, workerEmploymentEvents } from "@/db/schema";
import {
  projectWorker360Events,
  selectWorker360Assignment,
} from "@/lib/hcm-worker-360-projection";
import type { Worker360Summary } from "@/lib/hcm-worker-360-contract";

export const WORKER_360_EVENT_PAGE_SIZE = 25;

/**
 * Reads only the validated tenant and worker. Called AFTER the route's
 * session, role, custom-permission and company-wide authorization checks.
 *
 * Current employees.title/status are intentionally separated from historical
 * assignment rows. The position table is mutable; never use today's job/org
 * details to claim an accurate historical position snapshot.
 */
export async function loadWorker360Summary(
  organizationId: number,
  employeeId: number,
  asOfDate: string,
): Promise<Worker360Summary | null> {
  const [worker] = await db.select({
    id: employees.id,
    employeeNo: employees.employeeNo,
    firstName: employees.firstName,
    lastName: employees.lastName,
    title: employees.title,
    status: employees.status,
    startDate: employees.startDate,
  }).from(employees).where(and(
    eq(employees.organizationId, organizationId),
    eq(employees.id, employeeId),
  )).limit(1);
  if (!worker) return null;

  // LIMIT 2 suffices to detect overlapping primary as-of assignments, without
  // a costly unbounded historical load or selecting private position columns.
  const [assignments, events] = await Promise.all([
    db.select({
      id: positionAssignments.id,
      positionId: positionAssignments.positionId,
      assignmentType: positionAssignments.assignmentType,
      effectiveFrom: positionAssignments.effectiveFrom,
      effectiveUntil: positionAssignments.effectiveUntil,
    }).from(positionAssignments).where(and(
      eq(positionAssignments.organizationId, organizationId),
      eq(positionAssignments.employeeId, employeeId),
      eq(positionAssignments.assignmentType, "primary"),
      lte(positionAssignments.effectiveFrom, asOfDate),
      or(
        isNull(positionAssignments.effectiveUntil),
        gte(positionAssignments.effectiveUntil, asOfDate),
      ),
    )).orderBy(desc(positionAssignments.effectiveFrom), desc(positionAssignments.id)).limit(2),
    // Authorization and as-of filtering happen BEFORE the preview ceiling.
    db.select({
      id: workerEmploymentEvents.id,
      effectiveDate: workerEmploymentEvents.effectiveDate,
      eventType: workerEmploymentEvents.eventType,
      positionAssignmentId: workerEmploymentEvents.positionAssignmentId,
    }).from(workerEmploymentEvents).where(and(
      eq(workerEmploymentEvents.organizationId, organizationId),
      eq(workerEmploymentEvents.employeeId, employeeId),
      lte(workerEmploymentEvents.effectiveDate, asOfDate),
    )).orderBy(
      desc(workerEmploymentEvents.effectiveDate),
      desc(workerEmploymentEvents.id),
    ).limit(WORKER_360_EVENT_PAGE_SIZE + 1),
  ]);

  return {
    tenantId: organizationId,
    employeeId,
    asOfDate,
    observedAt: new Date().toISOString(),
    worker: {
      source: "employees",
      id: worker.id,
      employeeNo: worker.employeeNo,
      name: [worker.firstName, worker.lastName].filter(Boolean).join(" "),
      currentTitle: worker.title,
      currentStatus: worker.status,
      startedOn: worker.startDate,
    },
    primaryAssignment: {
      source: "position_assignments",
      selection: selectWorker360Assignment(assignments, asOfDate),
    },
    employmentEvents: {
      source: "worker_employment_events",
      preview: projectWorker360Events(events, asOfDate, WORKER_360_EVENT_PAGE_SIZE),
    },
  };
}
