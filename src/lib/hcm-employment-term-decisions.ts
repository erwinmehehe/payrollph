import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  hcmEmploymentTermDecisions,
  hcmEmploymentTerms,
  workerEmploymentEvents,
} from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { recordEmploymentDecisionEvidenceEvent } from "@/lib/hcm-employment-decision-evidence";
import {
  activateEmploymentTerm,
  EMPLOYMENT_TERM_KINDS,
  philippineBusinessDate,
} from "@/lib/hcm-employment-terms";

export const EMPLOYMENT_TERM_DECISION_KINDS = [
  "confirm_regular",
  "renew_term",
  "extend_term",
  "convert_terms",
  "non_renew",
  "continue_current",
] as const;

export type EmploymentTermDecisionKind = (typeof EMPLOYMENT_TERM_DECISION_KINDS)[number];

const SUCCESSOR_DECISIONS = new Set<EmploymentTermDecisionKind>([
  "confirm_regular",
  "renew_term",
  "extend_term",
  "convert_terms",
]);

function successorSpec(
  decision: typeof hcmEmploymentTermDecisions.$inferSelect,
  term: typeof hcmEmploymentTerms.$inferSelect,
) {
  if (!SUCCESSOR_DECISIONS.has(decision.decisionKind as EmploymentTermDecisionKind)) return null;

  const decisionKind = decision.decisionKind as EmploymentTermDecisionKind;
  const employmentType = decisionKind === "confirm_regular"
    ? (decision.nextEmploymentType || "Regular")
    : (decision.nextEmploymentType || term.employmentType);
  const termKind = decisionKind === "confirm_regular"
    ? "regular"
    : (decision.nextTermKind || term.termKind);

  if (!EMPLOYMENT_TERM_KINDS.includes(termKind as (typeof EMPLOYMENT_TERM_KINDS)[number])) {
    throw new Error("The approved decision has an unsupported successor term kind.");
  }
  if (!employmentType.trim()) throw new Error("The approved decision is missing the successor employment type.");

  const probationReviewDate = decisionKind === "confirm_regular"
    ? null
    : decision.nextProbationReviewDate;
  const contractEndDate = decisionKind === "confirm_regular"
    ? null
    : decision.nextContractEndDate;
  const effectiveUntil = decisionKind === "confirm_regular"
    ? null
    : decision.nextEffectiveUntil ?? (termKind === "fixed_term" ? contractEndDate : null);

  if (termKind === "probationary" && !probationReviewDate) {
    throw new Error("A successor probationary term requires an explicit review date.");
  }
  if (termKind === "fixed_term" && !contractEndDate) {
    throw new Error("A successor fixed-term record requires an explicit contract end date.");
  }
  if (termKind === "fixed_term" && effectiveUntil && String(effectiveUntil) !== String(contractEndDate)) {
    throw new Error("For a fixed-term successor, effective-until must match the contract end date.");
  }

  return {
    employmentType,
    termKind,
    effectiveFrom: String(decision.effectiveDate),
    effectiveUntil: effectiveUntil ? String(effectiveUntil) : null,
    probationReviewDate: probationReviewDate ? String(probationReviewDate) : null,
    contractEndDate: contractEndDate ? String(contractEndDate) : null,
    projectName: decision.nextProjectName,
  };
}

export async function applyEmploymentTermDecision(input: {
  decisionId: number;
  actor: string;
  actorUserId?: number | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const today = philippineBusinessDate(now);

  const prepared = await db.transaction(async (tx) => {
    const [decision] = await tx.select().from(hcmEmploymentTermDecisions)
      .where(eq(hcmEmploymentTermDecisions.id, input.decisionId))
      .limit(1);
    if (!decision) throw new Error("Employment-term decision not found.");
    if (decision.status === "applied") {
      return { decision, successorTermId: decision.successorTermId, alreadyApplied: true as const };
    }
    if (decision.status !== "scheduled") {
      throw new Error("Only approved scheduled employment-term decisions can apply.");
    }
    if (String(decision.effectiveDate) > today) {
      throw new Error("Employment-term decision cannot apply before its effective date.");
    }

    await tx.execute(sql`select id from employees where id = ${decision.employeeId} for update`);
    await tx.execute(sql`select id from hcm_employment_terms where id = ${decision.employmentTermId} for update`);

    const [employee] = await tx.select().from(employees).where(and(
      eq(employees.id, decision.employeeId),
      eq(employees.organizationId, decision.organizationId),
    )).limit(1);
    if (!employee) throw new Error("Employee not found for employment-term decision.");
    if (["Separating", "Separated"].includes(employee.status)) {
      throw new Error("Employment-term decisions cannot apply while the worker is in separation.");
    }

    const [term] = await tx.select().from(hcmEmploymentTerms).where(and(
      eq(hcmEmploymentTerms.id, decision.employmentTermId),
      eq(hcmEmploymentTerms.organizationId, decision.organizationId),
      eq(hcmEmploymentTerms.employeeId, decision.employeeId),
    )).limit(1);
    if (!term) throw new Error("Employment terms record not found for this decision.");
    if (term.status !== "active") {
      throw new Error("The source employment terms are no longer active; review the decision against current terms.");
    }

    if (decision.decisionKind === "non_renew") {
      if (!decision.proposedSeparationLastDay) {
        throw new Error("Non-renewal requires an explicit proposed last day for separation handoff.");
      }
      const [event] = await tx.insert(workerEmploymentEvents).values({
        organizationId: decision.organizationId,
        employeeId: decision.employeeId,
        effectiveDate: String(decision.effectiveDate),
        eventType: "employment_term_decision",
        fromEmploymentType: employee.employmentType,
        toEmploymentType: employee.employmentType,
        fromStatus: employee.status,
        toStatus: employee.status,
        reason: decision.reason,
        metadata: {
          employmentTermDecisionId: decision.id,
          employmentTermId: term.id,
          decisionKind: decision.decisionKind,
          proposedSeparationLastDay: decision.proposedSeparationLastDay,
          separationReason: decision.separationReason,
          separationHandoffStatus: "ready",
          autoSeparation: false,
          finalPayTriggered: false,
        },
        actorUserId: input.actorUserId ?? decision.approvedByUserId ?? decision.requestedByUserId,
        actorName: input.actor,
      }).returning();

      const [applied] = await tx.update(hcmEmploymentTermDecisions).set({
        status: "applied",
        separationHandoffStatus: "ready",
        appliedAt: now,
        failure: null,
        updatedAt: now,
      }).where(and(
        eq(hcmEmploymentTermDecisions.id, decision.id),
        eq(hcmEmploymentTermDecisions.status, "scheduled"),
      )).returning();
      if (!applied) throw new Error("Employment-term decision changed before application.");

      return { decision: applied, successorTermId: null, eventId: event.id, alreadyApplied: false as const };
    }

    if (decision.decisionKind === "continue_current") {
      const [event] = await tx.insert(workerEmploymentEvents).values({
        organizationId: decision.organizationId,
        employeeId: decision.employeeId,
        effectiveDate: String(decision.effectiveDate),
        eventType: "employment_term_decision",
        fromEmploymentType: employee.employmentType,
        toEmploymentType: employee.employmentType,
        fromStatus: employee.status,
        toStatus: employee.status,
        reason: decision.reason,
        metadata: {
          employmentTermDecisionId: decision.id,
          employmentTermId: term.id,
          decisionKind: decision.decisionKind,
          autoRegularization: false,
          autoRenewal: false,
          autoSeparation: false,
        },
        actorUserId: input.actorUserId ?? decision.approvedByUserId ?? decision.requestedByUserId,
        actorName: input.actor,
      }).returning();

      const [applied] = await tx.update(hcmEmploymentTermDecisions).set({
        status: "applied",
        appliedAt: now,
        failure: null,
        updatedAt: now,
      }).where(and(
        eq(hcmEmploymentTermDecisions.id, decision.id),
        eq(hcmEmploymentTermDecisions.status, "scheduled"),
      )).returning();
      if (!applied) throw new Error("Employment-term decision changed before application.");

      return { decision: applied, successorTermId: null, eventId: event.id, alreadyApplied: false as const };
    }

    const spec = successorSpec(decision, term);
    if (!spec) throw new Error("This employment-term decision has no supported application path.");

    const openTerms = await tx.select({ id: hcmEmploymentTerms.id }).from(hcmEmploymentTerms).where(and(
      eq(hcmEmploymentTerms.organizationId, decision.organizationId),
      eq(hcmEmploymentTerms.employeeId, decision.employeeId),
      inArray(hcmEmploymentTerms.status, ["pending_approval", "scheduled"]),
    )).limit(1);
    if (openTerms[0]) {
      throw new Error("A separate employment-terms change is already pending or scheduled for this worker.");
    }

    const [successor] = await tx.insert(hcmEmploymentTerms).values({
      organizationId: decision.organizationId,
      employeeId: decision.employeeId,
      employmentType: spec.employmentType,
      termKind: spec.termKind,
      effectiveFrom: spec.effectiveFrom,
      effectiveUntil: spec.effectiveUntil,
      probationReviewDate: spec.probationReviewDate,
      contractEndDate: spec.contractEndDate,
      projectName: spec.projectName,
      status: "scheduled",
      reason: `Approved employment-term decision #${decision.id}: ${decision.reason}`.slice(0, 240),
      requestedByUserId: decision.requestedByUserId,
      requestedBy: decision.requestedBy,
      approvedByUserId: decision.approvedByUserId,
      approvedBy: decision.approvedBy,
      approvedAt: decision.approvedAt ?? now,
    }).returning();

    return { decision, successorTermId: successor.id, alreadyApplied: false as const };
  });

  if (prepared.alreadyApplied) return prepared;

  if (prepared.successorTermId) {
    try {
      await activateEmploymentTerm({
        termId: prepared.successorTermId,
        actor: input.actor,
        actorUserId: input.actorUserId,
        now,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Successor employment terms could not activate.";
      await db.update(hcmEmploymentTerms).set({
        status: "failed",
        failure: message,
        updatedAt: now,
      }).where(eq(hcmEmploymentTerms.id, prepared.successorTermId));
      await db.update(hcmEmploymentTermDecisions).set({
        status: "failed",
        failure: message,
        successorTermId: prepared.successorTermId,
        updatedAt: now,
      }).where(eq(hcmEmploymentTermDecisions.id, prepared.decision.id));
      await recordEmploymentDecisionEvidenceEvent({
        organizationId: prepared.decision.organizationId,
        decisionId: prepared.decision.id,
        employeeId: prepared.decision.employeeId,
        eventType: "failed",
        actor: input.actor,
        actorUserId: input.actorUserId ?? null,
        metadata: { failure: message, successorTermId: prepared.successorTermId },
        createdAt: now,
      });
      throw new Error(message);
    }

    const [applied] = await db.update(hcmEmploymentTermDecisions).set({
      status: "applied",
      successorTermId: prepared.successorTermId,
      appliedAt: now,
      failure: null,
      updatedAt: now,
    }).where(and(
      eq(hcmEmploymentTermDecisions.id, prepared.decision.id),
      eq(hcmEmploymentTermDecisions.status, "scheduled"),
    )).returning();
    if (!applied) throw new Error("Employment-term decision changed after successor activation.");
    prepared.decision = applied;
  }

  await recordEmploymentDecisionEvidenceEvent({
    organizationId: prepared.decision.organizationId,
    decisionId: prepared.decision.id,
    employeeId: prepared.decision.employeeId,
    eventType: "applied",
    actor: input.actor,
    actorUserId: input.actorUserId ?? prepared.decision.approvedByUserId ?? prepared.decision.requestedByUserId,
    metadata: {
      employmentTermId: prepared.decision.employmentTermId,
      decisionKind: prepared.decision.decisionKind,
      successorTermId: prepared.successorTermId,
      separationHandoffStatus: prepared.decision.separationHandoffStatus,
    },
    createdAt: now,
  });

  await recordAuditEvent({
    organizationId: prepared.decision.organizationId,
    actor: input.actor,
    action: "HCM employment-term decision applied",
    resource: `Employee #${prepared.decision.employeeId}`,
    metadata: {
      employmentTermDecisionId: prepared.decision.id,
      employmentTermId: prepared.decision.employmentTermId,
      decisionKind: prepared.decision.decisionKind,
      successorTermId: prepared.successorTermId,
      separationHandoffStatus: prepared.decision.separationHandoffStatus,
    },
  });

  return prepared;
}

export async function runScheduledEmploymentTermDecisions(input: {
  actor?: string;
  now?: Date;
  limit?: number;
} = {}) {
  const now = input.now ?? new Date();
  const today = philippineBusinessDate(now);
  const rows = await db.select({ id: hcmEmploymentTermDecisions.id })
    .from(hcmEmploymentTermDecisions)
    .where(and(
      eq(hcmEmploymentTermDecisions.status, "scheduled"),
      lte(hcmEmploymentTermDecisions.effectiveDate, today),
    ))
    .limit(input.limit ?? 100);

  const results: Array<{ id: number; ok: boolean; error?: string }> = [];
  for (const row of rows) {
    try {
      await applyEmploymentTermDecision({
        decisionId: row.id,
        actor: input.actor ?? "System scheduler",
        now,
      });
      results.push({ id: row.id, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Employment-term decision failed.";
      const [failed] = await db.update(hcmEmploymentTermDecisions).set({
        status: "failed",
        failure: message,
        updatedAt: now,
      }).where(and(
        eq(hcmEmploymentTermDecisions.id, row.id),
        eq(hcmEmploymentTermDecisions.status, "scheduled"),
      )).returning();
      if (failed) {
        await recordEmploymentDecisionEvidenceEvent({
          organizationId: failed.organizationId,
          decisionId: failed.id,
          employeeId: failed.employeeId,
          eventType: "failed",
          actor: input.actor ?? "System scheduler",
          metadata: { failure: message, scheduledApplication: true },
          createdAt: now,
        });
      }
      results.push({ id: row.id, ok: false, error: message });
    }
  }
  return results;
}
