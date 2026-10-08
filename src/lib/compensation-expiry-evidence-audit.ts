import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents,
  compensationEvents,
  employeeCompensationComponents,
} from "@/db/schema";

export type ExpiryEvidenceFindingCode =
  | "missing_effective_end"
  | "missing_financial_event"
  | "duplicate_financial_events"
  | "financial_date_mismatch"
  | "financial_employee_mismatch"
  | "missing_operational_audit"
  | "duplicate_operational_audits"
  | "audit_event_link_mismatch";

export type ExpiryEvidenceFinding = {
  assignmentId: number;
  effectiveUntil: string | null;
  codes: ExpiryEvidenceFindingCode[];
  financialEventIds: number[];
  auditEventIds: number[];
};

/**
 * Read-only legacy evidence inspection. It neither assumes old rows are
 * compliant nor fabricates historical events. IDs and issue categories are
 * sufficient for an operator to reconcile against source records; no names,
 * bank details, pay amounts, or other employee PII are returned.
 *
 * An explicit organization boundary and deterministic keyset pagination keep
 * this safe for tenant-scoped, repeatable evidence reviews.
 */
export async function inspectEndedCompensationEvidence(input: {
  organizationId: number;
  afterAssignmentId?: number;
  limit?: number;
}) {
  if (!Number.isSafeInteger(input.organizationId) || input.organizationId <= 0) {
    throw new Error("A positive organizationId is required for compensation evidence review.");
  }
  const afterAssignmentId = input.afterAssignmentId ?? 0;
  if (!Number.isSafeInteger(afterAssignmentId) || afterAssignmentId < 0) {
    throw new Error("afterAssignmentId must be a nonnegative integer.");
  }
  const rawLimit = input.limit ?? 100;
  if (!Number.isSafeInteger(rawLimit) || rawLimit < 1 || rawLimit > 250) {
    throw new Error("Audit page limit must be an integer between 1 and 250.");
  }

  const rawAssignments = await db.select({
    id: employeeCompensationComponents.id,
    employeeId: employeeCompensationComponents.employeeId,
    effectiveUntil: employeeCompensationComponents.effectiveUntil,
  }).from(employeeCompensationComponents).where(and(
    eq(employeeCompensationComponents.organizationId, input.organizationId),
    eq(employeeCompensationComponents.status, "ended"),
    gt(employeeCompensationComponents.id, afterAssignmentId),
  )).orderBy(asc(employeeCompensationComponents.id)).limit(rawLimit + 1);

  const hasMore = rawAssignments.length > rawLimit;
  const assignments = rawAssignments.slice(0, rawLimit);
  const assignmentIds = assignments.map((row) => row.id);

  const [events, audits] = assignmentIds.length
    ? await Promise.all([
        db.select({
          id: compensationEvents.id,
          assignmentId: compensationEvents.componentAssignmentId,
          employeeId: compensationEvents.employeeId,
          effectiveDate: compensationEvents.effectiveDate,
        }).from(compensationEvents).where(and(
          eq(compensationEvents.organizationId, input.organizationId),
          eq(compensationEvents.eventType, "component_ended"),
          inArray(compensationEvents.componentAssignmentId, assignmentIds),
        )),
        db.select({
          id: auditEvents.id,
          metadata: auditEvents.metadata,
        }).from(auditEvents).where(and(
          eq(auditEvents.organizationId, input.organizationId),
          eq(auditEvents.action, "Recurring compensation component ended"),
          inArray(
            sql<string>`(${auditEvents.metadata} ->> 'componentAssignmentId')`,
            assignmentIds.map(String),
          ),
        )),
      ])
    : [[], []];

  const eventGroups = new Map<number, typeof events>();
  for (const event of events) {
    if (event.assignmentId == null) continue;
    eventGroups.set(event.assignmentId, [...(eventGroups.get(event.assignmentId) ?? []), event]);
  }
  const auditGroups = new Map<number, typeof audits>();
  for (const audit of audits) {
    const metadata = audit.metadata as Record<string, unknown> | null;
    const assignmentId = Number(metadata?.componentAssignmentId);
    if (!Number.isSafeInteger(assignmentId)) continue;
    auditGroups.set(assignmentId, [...(auditGroups.get(assignmentId) ?? []), audit]);
  }

  const findings: ExpiryEvidenceFinding[] = [];
  let completeCount = 0;
  for (const assignment of assignments) {
    const codes: ExpiryEvidenceFindingCode[] = [];
    const financial = eventGroups.get(assignment.id) ?? [];
    const operational = auditGroups.get(assignment.id) ?? [];
    const financialIds = financial.map((event) => event.id);
    const auditIds = operational.map((audit) => audit.id);

    if (!assignment.effectiveUntil) codes.push("missing_effective_end");
    if (financial.length === 0) codes.push("missing_financial_event");
    if (financial.length > 1) codes.push("duplicate_financial_events");
    if (financial.some((event) => String(event.effectiveDate) !== String(assignment.effectiveUntil))) {
      codes.push("financial_date_mismatch");
    }
    if (financial.some((event) => event.employeeId !== assignment.employeeId)) {
      codes.push("financial_employee_mismatch");
    }
    if (operational.length === 0) codes.push("missing_operational_audit");
    if (operational.length > 1) codes.push("duplicate_operational_audits");
    if (operational.length > 0 && operational.some((audit) => {
      const metadata = audit.metadata as Record<string, unknown> | null;
      const linkedId = Number(metadata?.compensationEventId);
      return !Number.isSafeInteger(linkedId) || !financialIds.includes(linkedId);
    })) {
      codes.push("audit_event_link_mismatch");
    }

    if (codes.length === 0) completeCount++;
    else findings.push({
      assignmentId: assignment.id,
      effectiveUntil: assignment.effectiveUntil ? String(assignment.effectiveUntil) : null,
      codes,
      financialEventIds: financialIds,
      auditEventIds: auditIds,
    });
  }

  return {
    organizationId: input.organizationId,
    afterAssignmentId,
    examined: assignments.length,
    completeCount,
    needsReviewCount: findings.length,
    findings,
    nextCursor: hasMore ? assignments[assignments.length - 1].id : null,
    readOnly: true as const,
    independentlyVerified: false as const,
  };
}
