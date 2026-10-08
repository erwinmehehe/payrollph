import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents,
  compensationAutomationIntents,
  compensationCycles,
  compensationEvents,
  compensationProposals,
  employeePayRevisions,
} from "@/db/schema";

export type SalaryEvidenceIssue =
  | "missing_cycle"
  | "missing_pay_revision"
  | "revision_employee_mismatch"
  | "revision_date_mismatch"
  | "missing_salary_event"
  | "duplicate_salary_events"
  | "event_employee_mismatch"
  | "event_date_mismatch"
  | "event_revision_mismatch"
  | "missing_operational_audit"
  | "duplicate_operational_audits"
  | "audit_event_link_mismatch"
  | "audit_revision_mismatch"
  | "missing_notification_intent"
  | "duplicate_notification_intents"
  | "unexpected_notification_intent"
  | "notification_trigger_mismatch"
  | "notification_employee_mismatch"
  | "notification_needs_review";

export type AppliedSalaryEvidenceFinding = {
  proposalId: number;
  issues: SalaryEvidenceIssue[];
  salaryEventIds: number[];
  operationalAuditIds: number[];
  notificationIntentIds: number[];
};

/**
 * Read-only evidence inspection for approved salary proposals already marked
 * applied. This is not a payroll recomputation or evidence backfill.
 *
 * Every query is tenant-scoped and executed on one repeatable-read, READ ONLY
 * PostgreSQL snapshot. The report deliberately returns no names, pay values,
 * event payloads, automation context or bank information.
 *
 * Applied records predating the transactional outbox are EXPECTED to require
 * independent historical review. Never auto-create a missing financial event,
 * operational audit or notification intent.
 */
export async function inspectAppliedSalaryEvidence(input: {
  organizationId: number;
  afterProposalId?: number;
  limit?: number;
}) {
  const { organizationId } = input;
  const afterProposalId = input.afterProposalId ?? 0;
  const limit = input.limit ?? 100;
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0
    || !Number.isSafeInteger(afterProposalId) || afterProposalId < 0
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 250) {
    throw new Error("Salary evidence review needs a positive organization ID, nonnegative cursor and page size 1-250.");
  }

  return db.transaction(async (tx) => {
    // Protect review from racing commits and enforce no writes even if future
    // code accidentally adds a mutation inside this transaction.
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`);

    const candidates = await tx.select({
      id: compensationProposals.id,
      employeeId: compensationProposals.employeeId,
      cycleId: compensationProposals.cycleId,
      payRevisionId: compensationProposals.appliedPayRevisionId,
    }).from(compensationProposals).where(and(
      eq(compensationProposals.organizationId, organizationId),
      eq(compensationProposals.status, "applied"),
      gt(compensationProposals.id, afterProposalId),
    )).orderBy(asc(compensationProposals.id)).limit(limit + 1);

    const hasMore = candidates.length > limit;
    const proposals = candidates.slice(0, limit);
    if (proposals.length === 0) {
      return {
        organizationId, afterProposalId, examined: 0,
        completeEvidenceCount: 0, needsReviewCount: 0,
        pendingDeliveryCount: 0, findings: [] as AppliedSalaryEvidenceFinding[],
        nextCursor: null as number | null,
        readOnly: true as const,
        independentlyVerified: false as const,
      };
    }

    const proposalIds = proposals.map((proposal) => proposal.id);
    const cycleIds = [...new Set(proposals.map((proposal) => proposal.cycleId))];
    const revisionIds = [...new Set(proposals.flatMap((proposal) =>
      proposal.payRevisionId == null ? [] : [proposal.payRevisionId],
    ))];

    const cycles = await tx.select({
      id: compensationCycles.id,
      effectiveDate: compensationCycles.effectiveDate,
    }).from(compensationCycles).where(and(
      eq(compensationCycles.organizationId, organizationId),
      inArray(compensationCycles.id, cycleIds),
    ));
    const revisions = revisionIds.length ? await tx.select({
      id: employeePayRevisions.id,
      employeeId: employeePayRevisions.employeeId,
      effectiveDate: employeePayRevisions.effectiveDate,
    }).from(employeePayRevisions).where(and(
      eq(employeePayRevisions.organizationId, organizationId),
      inArray(employeePayRevisions.id, revisionIds),
    )) : [];
    const financialEvents = await tx.select({
      id: compensationEvents.id,
      proposalId: compensationEvents.proposalId,
      employeeId: compensationEvents.employeeId,
      payRevisionId: compensationEvents.payRevisionId,
      effectiveDate: compensationEvents.effectiveDate,
    }).from(compensationEvents).where(and(
      eq(compensationEvents.organizationId, organizationId),
      eq(compensationEvents.eventType, "salary_change"),
      inArray(compensationEvents.proposalId, proposalIds),
    ));
    const financialIds = financialEvents.map((event) => event.id);

    const audits = await tx.select({
      id: auditEvents.id,
      metadata: auditEvents.metadata,
    }).from(auditEvents).where(and(
      eq(auditEvents.organizationId, organizationId),
      eq(auditEvents.action, "Scheduled compensation change applied"),
      inArray(
        sql<string>`(${auditEvents.metadata} ->> 'proposalId')`,
        proposalIds.map(String),
      ),
    ));
    const intents = financialIds.length ? await tx.select({
      id: compensationAutomationIntents.id,
      compensationEventId: compensationAutomationIntents.compensationEventId,
      employeeId: compensationAutomationIntents.employeeId,
      trigger: compensationAutomationIntents.trigger,
      eventKey: compensationAutomationIntents.eventKey,
      status: compensationAutomationIntents.status,
    }).from(compensationAutomationIntents).where(and(
      eq(compensationAutomationIntents.organizationId, organizationId),
      inArray(compensationAutomationIntents.compensationEventId, financialIds),
    )) : [];

    const cycleMap = new Map(cycles.map((row) => [row.id, row]));
    const revisionMap = new Map(revisions.map((row) => [row.id, row]));
    const eventsByProposal = new Map<number, typeof financialEvents>();
    for (const event of financialEvents) {
      if (event.proposalId == null) continue;
      eventsByProposal.set(event.proposalId, [
        ...(eventsByProposal.get(event.proposalId) ?? []), event,
      ]);
    }

    const auditsByProposal = new Map<number, typeof audits>();
    for (const audit of audits) {
      const data = audit.metadata as Record<string, unknown> | null;
      const proposalId = Number(data?.proposalId);
      if (!Number.isSafeInteger(proposalId)) continue;
      auditsByProposal.set(proposalId, [
        ...(auditsByProposal.get(proposalId) ?? []), audit,
      ]);
    }

    const intentsByEvent = new Map<number, typeof intents>();
    for (const intent of intents) {
      intentsByEvent.set(intent.compensationEventId, [
        ...(intentsByEvent.get(intent.compensationEventId) ?? []), intent,
      ]);
    }

    const findings: AppliedSalaryEvidenceFinding[] = [];
    let completeEvidenceCount = 0;
    let pendingDeliveryCount = 0;
    for (const proposal of proposals) {
      const issues: SalaryEvidenceIssue[] = [];
      const cycle = cycleMap.get(proposal.cycleId);
      const revision = proposal.payRevisionId == null
        ? undefined : revisionMap.get(proposal.payRevisionId);
      const events = eventsByProposal.get(proposal.id) ?? [];
      const auditRows = auditsByProposal.get(proposal.id) ?? [];
      const eventIds = events.map((event) => event.id);
      const notifications = events.flatMap((event) => intentsByEvent.get(event.id) ?? []);

      if (!cycle) issues.push("missing_cycle");
      if (!revision) issues.push("missing_pay_revision");
      if (revision && revision.employeeId !== proposal.employeeId) {
        issues.push("revision_employee_mismatch");
      }
      if (revision && cycle && String(revision.effectiveDate) !== String(cycle.effectiveDate)) {
        issues.push("revision_date_mismatch");
      }
      if (events.length === 0) issues.push("missing_salary_event");
      if (events.length > 1) issues.push("duplicate_salary_events");
      if (events.some((event) => event.employeeId !== proposal.employeeId)) {
        issues.push("event_employee_mismatch");
      }
      if (cycle && events.some((event) => String(event.effectiveDate) !== String(cycle.effectiveDate))) {
        issues.push("event_date_mismatch");
      }
      if (revision && events.some((event) => event.payRevisionId !== revision.id)) {
        issues.push("event_revision_mismatch");
      }
      if (auditRows.length === 0) issues.push("missing_operational_audit");
      if (auditRows.length > 1) issues.push("duplicate_operational_audits");
      if (auditRows.some((audit) => {
        const data = audit.metadata as Record<string, unknown> | null;
        const linkedEventId = Number(data?.compensationEventId);
        return !Number.isSafeInteger(linkedEventId) || !eventIds.includes(linkedEventId);
      })) issues.push("audit_event_link_mismatch");
      if (revision && auditRows.some((audit) => {
        const data = audit.metadata as Record<string, unknown> | null;
        return Number(data?.payRevisionId) !== revision.id;
      })) issues.push("audit_revision_mismatch");

      const expected = [
        { eventKey: `compensation-applied:${proposal.id}`, trigger: "compensation.changed" },
        { eventKey: `compensation-applied:${proposal.id}:field-change:annualsalary`, trigger: "employee.field_changed" },
        { eventKey: `compensation-applied:${proposal.id}:field-change:monthlyequivalentsalary`, trigger: "employee.field_changed" },
      ];
      const expectedKeys = new Set(expected.map((row) => row.eventKey));
      if (expected.some((row) =>
        notifications.filter((intent) => intent.eventKey === row.eventKey).length === 0
      )) issues.push("missing_notification_intent");
      if (expected.some((row) =>
        notifications.filter((intent) => intent.eventKey === row.eventKey).length > 1
      )) issues.push("duplicate_notification_intents");
      if (notifications.some((intent) => !expectedKeys.has(intent.eventKey))) {
        issues.push("unexpected_notification_intent");
      }
      if (expected.some((row) => notifications.some((intent) =>
        intent.eventKey === row.eventKey && intent.trigger !== row.trigger
      ))) issues.push("notification_trigger_mismatch");
      if (notifications.some((intent) => intent.employeeId !== proposal.employeeId)) {
        issues.push("notification_employee_mismatch");
      }
      if (notifications.some((intent) => intent.status === "needs_review")) {
        issues.push("notification_needs_review");
      }
      pendingDeliveryCount += notifications.filter((intent) =>
        ["pending", "retry", "leased"].includes(intent.status)
      ).length;

      if (issues.length > 0) {
        findings.push({
          proposalId: proposal.id,
          issues,
          salaryEventIds: eventIds,
          operationalAuditIds: auditRows.map((audit) => audit.id),
          notificationIntentIds: notifications.map((intent) => intent.id),
        });
      } else completeEvidenceCount++;
    }

    return {
      organizationId,
      afterProposalId,
      examined: proposals.length,
      completeEvidenceCount,
      needsReviewCount: findings.length,
      pendingDeliveryCount,
      findings,
      nextCursor: hasMore ? proposals[proposals.length - 1].id : null,
      readOnly: true as const,
      independentlyVerified: false as const,
    };
  });
}
