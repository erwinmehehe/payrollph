import { and, asc, eq, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  approvalTasks,
  auditEvents,
  compensationBands,
  compensationEvents,
  compensationProposals,
  compensationCycles,
  employeeCompensationComponents,
  employeePayProfiles,
  employeePayRevisions,
  employees,
  payrollEntries,
  payrollRuns,
  workerEffectiveChanges,
} from "@/db/schema";
import { fieldChangeContext } from "@/lib/automation-change-events";
import {
  dispatchCompensationAutomationEvent,
  enqueueCompensationAutomationIntents,
} from "@/lib/compensation-automation-outbox";
import { annualizePay, compaRatio } from "@/lib/compensation";
import { resolvePayProfile } from "@/lib/pay-basis";

const BUSY_PAYROLL_STATUSES = new Set(["Queued", "Processing", "Recalculating", "Releasing"]);

// Allows a compensation decision and any impacted payroll invalidation to
// succeed or roll back together. A separate nested transaction would reset a
// payroll run even if the later proposal approval fails.
type CompensationTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Infrastructure evidence failures MUST NOT poison a valid scheduled salary.
 * Everything in the pay transaction is rolled back, so a scheduler may retry
 * the original approved decision without fabricating or rewriting pay.
 */
export class ScheduledCompensationAuditWriteError extends Error {
  constructor() {
    super("Scheduled salary application audit could not be saved. Salary was not changed; retry after audit storage recovers.");
    this.name = "ScheduledCompensationAuditWriteError";
  }
}

export class ScheduledCompensationIntentWriteError extends Error {
  constructor() {
    super("Scheduled salary notification intent could not be saved. Salary was not changed; retry after delivery storage recovers.");
    this.name = "ScheduledCompensationIntentWriteError";
  }
}


export function philippineBusinessDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(now);
}

export async function compensationPayrollConflicts(input: {
  organizationId: number;
  employeeOrgUnitId: number | null;
  effectiveFrom: string;
  effectiveUntil?: string | null;
}, transaction?: CompensationTransaction) {
  const end = input.effectiveUntil ?? "9999-12-31";
  const runs = transaction
    ? await transaction.select().from(payrollRuns).where(eq(payrollRuns.organizationId, input.organizationId))
    : await db.select().from(payrollRuns).where(eq(payrollRuns.organizationId, input.organizationId));
  const overlapping = runs.filter((run) =>
    String(run.periodStart) <= end
    && String(run.periodEnd) >= input.effectiveFrom
    && (run.scopeOrgUnitId == null || run.scopeOrgUnitId === input.employeeOrgUnitId)
  );

  const busy = overlapping.find((run) => BUSY_PAYROLL_STATUSES.has(run.status));
  if (busy) {
    throw new Error(
      `Compensation cannot change while payroll run #${busy.id} is ${busy.status}. Retry after that payroll action finishes.`,
    );
  }

  const released = overlapping.find((run) => run.status === "Released");
  if (released) {
    throw new Error(
      `Payroll run #${released.id} covering this compensation effective period is already released. Use the audited pay-correction/retro workflow instead of rewriting released payroll.`,
    );
  }

  return overlapping.filter((run) =>
    run.status !== "Draft"
    || Number(run.employeeCount ?? 0) > 0
    || Number(run.processedChunks ?? 0) > 0
  );
}

export async function invalidatePayrollRunsForCompensationChange(
  organizationId: number,
  runs: Awaited<ReturnType<typeof compensationPayrollConflicts>>,
  transaction?: CompensationTransaction,
) {
  if (runs.length === 0) return [] as number[];

  const invalidate = async (tx: CompensationTransaction) => {
    const tasks = await tx.select().from(approvalTasks).where(eq(approvalTasks.organizationId, organizationId));
    const invalidated: number[] = [];

    for (const run of runs) {
      await tx.delete(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
      const [updated] = await tx.update(payrollRuns).set({
        status: "Draft",
        employeeCount: 0,
        grossPay: "0",
        netPay: "0",
        exceptions: 0,
        processedChunks: 0,
        totalChunks: 0,
      }).where(and(
        eq(payrollRuns.id, run.id),
        eq(payrollRuns.status, run.status),
      )).returning({ id: payrollRuns.id });

      if (!updated) {
        throw new Error(
          `Payroll run #${run.id} changed state while compensation was being approved. No compensation mutation was applied; retry after payroll activity finishes.`,
        );
      }
      invalidated.push(updated.id);

      for (const task of tasks) {
        if (!task.detail.includes(`Payroll run #${run.id}`)) continue;
        if (task.status !== "Pending" && task.status !== "Approved") continue;
        await tx.update(approvalTasks).set({
          status: "Superseded",
          decidedBy: "System",
          decidedAt: new Date(),
        }).where(eq(approvalTasks.id, task.id));
      }
    }

    return invalidated;
  };

  return transaction ? invalidate(transaction) : db.transaction(invalidate);
}


/**
 * Cancel a pending or unapplied salary proposal without leaving a payroll run
 * reset if the cancellation/revision removal fails halfway through.
 *
 * Lock order: proposal (4220, shared with activation scheduler) -> cycle (4230,
 * shared with salary approvals) -> employee (4221, shared with both).
 * The state/tenant/revision checks below run after all three locks are held.
 */
export async function cancelGovernedCompensationProposal(input: {
  proposalId: number;
  organizationId: number;
  employeeId: number;
  actorUserId: number;
  actorName: string;
  now?: Date;
  onCancelled?: (tx: CompensationTransaction) => Promise<void>;
}) {
  const now = input.now ?? new Date();
  const today = philippineBusinessDate(now);

  return db.transaction(async (tx) => {
    const [initial] = await tx.select({
      cycleId: compensationProposals.cycleId,
      employeeId: compensationProposals.employeeId,
    }).from(compensationProposals).where(and(
      eq(compensationProposals.id, input.proposalId),
      eq(compensationProposals.organizationId, input.organizationId),
      eq(compensationProposals.employeeId, input.employeeId),
    )).limit(1);
    if (!initial) throw new Error("COMPENSATION_CANCELLATION_STALE");

    await tx.execute(sql`select pg_advisory_xact_lock(4220, ${input.proposalId})`);
    await tx.execute(sql`select pg_advisory_xact_lock(4230, ${initial.cycleId})`);
    await tx.execute(sql`select pg_advisory_xact_lock(4221, ${initial.employeeId})`);

    const [[proposal], [cycle], [employee]] = await Promise.all([
      tx.select().from(compensationProposals).where(and(
        eq(compensationProposals.id, input.proposalId),
        eq(compensationProposals.organizationId, input.organizationId),
        eq(compensationProposals.employeeId, input.employeeId),
      )).limit(1),
      tx.select().from(compensationCycles).where(and(
        eq(compensationCycles.id, initial.cycleId),
        eq(compensationCycles.organizationId, input.organizationId),
      )).limit(1),
      tx.select().from(employees).where(and(
        eq(employees.id, input.employeeId),
        eq(employees.organizationId, input.organizationId),
      )).limit(1),
    ]);

    if (!proposal || !cycle || !employee || proposal.cycleId !== cycle.id
        || proposal.employeeId !== initial.employeeId) {
      throw new Error("COMPENSATION_CANCELLATION_STALE");
    }
    if (!["proposed", "scheduled", "failed"].includes(proposal.status)) {
      throw new Error("COMPENSATION_CANCELLATION_STALE");
    }

    const effectiveDate = String(cycle.effectiveDate);
    const pricedByPayroll = proposal.status === "scheduled" || proposal.status === "failed";
    let cancelledPayRevisionId: number | null = null;
    let invalidatedPayrollRunIds: number[] = [];

    if (pricedByPayroll) {
      // From the effective day onward, salary could already have been earned or
      // activated by the scheduler. This route is not an audited retro workflow.
      if (effectiveDate <= today) throw new Error("COMPENSATION_CANCELLATION_RETROACTIVE");
      if (!proposal.appliedPayRevisionId) throw new Error("COMPENSATION_CANCELLATION_REVISION_STALE");

      const [revision] = await tx.select().from(employeePayRevisions).where(and(
        eq(employeePayRevisions.id, proposal.appliedPayRevisionId),
        eq(employeePayRevisions.organizationId, input.organizationId),
        eq(employeePayRevisions.employeeId, input.employeeId),
      )).limit(1);
      if (!revision || String(revision.effectiveDate) !== effectiveDate) {
        throw new Error("COMPENSATION_CANCELLATION_REVISION_STALE");
      }
      cancelledPayRevisionId = revision.id;

      const employeeRevisions = await tx.select().from(employeePayRevisions).where(and(
        eq(employeePayRevisions.organizationId, input.organizationId),
        eq(employeePayRevisions.employeeId, input.employeeId),
      ));
      if (employeeRevisions.some((entry) =>
        entry.id !== revision.id && String(entry.effectiveDate) > effectiveDate
      )) {
        throw new Error("COMPENSATION_CANCELLATION_DOWNSTREAM_REVISION");
      }

      // A linked revision must not silently be detached from another proposal.
      const linkedProposals = await tx.select({ id: compensationProposals.id })
        .from(compensationProposals)
        .where(eq(compensationProposals.appliedPayRevisionId, revision.id));
      if (linkedProposals.some((linked) => linked.id !== proposal.id)) {
        throw new Error("COMPENSATION_CANCELLATION_REVISION_STALE");
      }

      const affected = await compensationPayrollConflicts({
        organizationId: input.organizationId,
        employeeOrgUnitId: employee.orgUnitId,
        effectiveFrom: effectiveDate,
        effectiveUntil: null,
      }, tx);
      invalidatedPayrollRunIds = await invalidatePayrollRunsForCompensationChange(
        input.organizationId,
        affected,
        tx,
      );
    } else if (proposal.appliedPayRevisionId !== null) {
      // A proposed (unapproved) change must never delete an orphaned pay revision.
      throw new Error("COMPENSATION_CANCELLATION_REVISION_STALE");
    }

    const [updated] = await tx.update(compensationProposals).set({
      status: "cancelled",
      appliedPayRevisionId: null,
      failure: null,
      updatedAt: now,
    }).where(and(
      eq(compensationProposals.id, proposal.id),
      eq(compensationProposals.organizationId, input.organizationId),
      eq(compensationProposals.status, proposal.status),
    )).returning();
    if (!updated) throw new Error("COMPENSATION_CANCELLATION_STALE");

    if (cancelledPayRevisionId != null) {
      const [deleted] = await tx.delete(employeePayRevisions).where(and(
        eq(employeePayRevisions.id, cancelledPayRevisionId),
        eq(employeePayRevisions.organizationId, input.organizationId),
        eq(employeePayRevisions.employeeId, input.employeeId),
      )).returning({ id: employeePayRevisions.id });
      if (!deleted) throw new Error("COMPENSATION_CANCELLATION_REVISION_STALE");
    }

    const evidence = {
      priorStatus: proposal.status,
      reason: proposal.reason,
      compensationCycleId: cycle.id,
      cancelledPayRevisionId,
      invalidatedPayrollRunIds,
      linkedWorkerChangeId: proposal.workerEffectiveChangeId,
    };
    await tx.insert(compensationEvents).values({
      organizationId: updated.organizationId,
      employeeId: updated.employeeId,
      eventType: "salary_change_cancelled",
      effectiveDate,
      bandId: updated.bandId,
      proposalId: updated.id,
      metadata: evidence,
      actorUserId: input.actorUserId,
      actorName: input.actorName,
    });
    await tx.insert(auditEvents).values({
      organizationId: updated.organizationId,
      actor: input.actorName,
      action: pricedByPayroll ? "Scheduled compensation proposal cancelled" : "Compensation proposal cancelled",
      resource: `Proposal #${updated.id}`,
      metadata: { employeeId: updated.employeeId, ...evidence },
    });

    await input.onCancelled?.(tx);
    return { proposal: updated, invalidatedPayrollRunIds, cancelledPayRevisionId };
  });
}

export async function applyScheduledCompensationProposal(
  proposalId: number,
  options: { actor?: string; actorUserId?: number | null; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  const today = philippineBusinessDate(now);
  const actor = options.actor ?? "System scheduler";
  const actorUserId = options.actorUserId ?? null;

  const [existing] = await db.select().from(compensationProposals)
    .where(eq(compensationProposals.id, proposalId))
    .limit(1);
  if (!existing) return { skipped: true as const, reason: "missing" };
  if (existing.status === "applied") return { skipped: true as const, reason: "already_applied", proposal: existing };
  if (existing.status !== "scheduled") return { skipped: true as const, reason: "not_scheduled", proposal: existing };

  const [existingCycle] = await db.select().from(compensationCycles)
    .where(eq(compensationCycles.id, existing.cycleId))
    .limit(1);
  if (!existingCycle) throw new Error("The compensation cycle no longer exists.");
  if (String(existingCycle.effectiveDate) > today) {
    return { skipped: true as const, reason: "not_due", proposal: existing };
  }

  let result;
  try {
    result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(4220, ${proposalId})`);

      const [proposal] = await tx.select().from(compensationProposals)
        .where(eq(compensationProposals.id, proposalId))
        .limit(1);
      if (!proposal || proposal.status !== "scheduled") {
        return { skipped: true as const, reason: "claimed" as const, proposal: proposal ?? null };
      }

      // Match cancellation/approval lock order: proposal -> cycle -> worker.
      await tx.execute(sql`select pg_advisory_xact_lock(4230, ${proposal.cycleId})`);
      await tx.execute(sql`select pg_advisory_xact_lock(4221, ${proposal.employeeId})`);

      const [[cycle], [revision], [pay], [employee], [band]] = await Promise.all([
        tx.select().from(compensationCycles).where(eq(compensationCycles.id, proposal.cycleId)).limit(1),
        proposal.appliedPayRevisionId
          ? tx.select().from(employeePayRevisions).where(eq(employeePayRevisions.id, proposal.appliedPayRevisionId)).limit(1)
          : Promise.resolve([]),
        tx.select().from(employeePayProfiles).where(and(
          eq(employeePayProfiles.employeeId, proposal.employeeId),
          eq(employeePayProfiles.organizationId, proposal.organizationId),
        )).limit(1),
        tx.select().from(employees).where(and(
          eq(employees.id, proposal.employeeId),
          eq(employees.organizationId, proposal.organizationId),
        )).limit(1),
        tx.select().from(compensationBands).where(eq(compensationBands.id, proposal.bandId)).limit(1),
      ]);

      if (!cycle || !revision || !pay || !employee || !band) {
        throw new Error("The scheduled compensation proposal is missing its cycle, revision, employee, pay profile, or salary band.");
      }
      if (proposal.workerEffectiveChangeId) {
        const [linkedPromotion] = await tx.select({
          id: workerEffectiveChanges.id,
          status: workerEffectiveChanges.status,
          effectiveDate: workerEffectiveChanges.effectiveDate,
          movementType: workerEffectiveChanges.movementType,
          employeeId: workerEffectiveChanges.employeeId,
        }).from(workerEffectiveChanges).where(and(
          eq(workerEffectiveChanges.id, proposal.workerEffectiveChangeId),
          eq(workerEffectiveChanges.organizationId, proposal.organizationId),
        )).limit(1);
        if (
          !linkedPromotion
          || linkedPromotion.employeeId !== proposal.employeeId
          || linkedPromotion.movementType !== "promotion"
          || String(linkedPromotion.effectiveDate) !== String(cycle.effectiveDate)
          || linkedPromotion.status !== "applied"
        ) {
          throw new Error("The linked promotion has not been successfully applied. Compensation will not activate ahead of the worker movement.");
        }
      }
      if (String(cycle.effectiveDate) > today) {
        return { skipped: true as const, reason: "not_due" as const, proposal };
      }

      const sameCurrentState =
        pay.payBasis === revision.previousPayBasis
        && Math.abs(Number(pay.rateAmount) - Number(revision.previousRateAmount)) < 0.01
        && Math.abs(Number(pay.standardWorkDaysPerMonth) - Number(revision.previousStandardWorkDaysPerMonth)) < 0.001
        && Math.abs(Number(pay.standardHoursPerDay) - Number(revision.previousStandardHoursPerDay)) < 0.001;
      if (!sameCurrentState) {
        throw new Error("The worker's current pay changed after this compensation proposal was scheduled. Review and resubmit instead of overwriting the newer pay state.");
      }

      const resolved = resolvePayProfile({
        payBasis: revision.newPayBasis,
        rateAmount: revision.newRateAmount,
        standardWorkDaysPerMonth: revision.newStandardWorkDaysPerMonth,
        standardHoursPerDay: revision.newStandardHoursPerDay,
      });

      await tx.update(employeePayProfiles).set({
        payBasis: revision.newPayBasis,
        rateAmount: revision.newRateAmount,
        standardWorkDaysPerMonth: revision.newStandardWorkDaysPerMonth,
        standardHoursPerDay: revision.newStandardHoursPerDay,
        updatedAt: now,
      }).where(eq(employeePayProfiles.id, pay.id));

      await tx.update(employees).set({
        basicRate: resolved.monthlyEquivalent.toFixed(2),
      }).where(and(
        eq(employees.id, proposal.employeeId),
        eq(employees.organizationId, proposal.organizationId),
      ));

      const beforeAnnual = annualizePay({
        payBasis: revision.previousPayBasis,
        rateAmount: Number(revision.previousRateAmount),
        standardWorkDaysPerMonth: Number(revision.previousStandardWorkDaysPerMonth),
        standardHoursPerDay: Number(revision.previousStandardHoursPerDay),
      });
      const afterAnnual = annualizePay({
        payBasis: revision.newPayBasis,
        rateAmount: Number(revision.newRateAmount),
        standardWorkDaysPerMonth: Number(revision.newStandardWorkDaysPerMonth),
        standardHoursPerDay: Number(revision.newStandardHoursPerDay),
      });

      const [event] = await tx.insert(compensationEvents).values({
        organizationId: proposal.organizationId,
        employeeId: proposal.employeeId,
        eventType: "salary_change",
        effectiveDate: String(cycle.effectiveDate),
        previousAnnual: beforeAnnual.toFixed(2),
        newAnnual: afterAnnual.toFixed(2),
        bandId: proposal.bandId,
        proposalId: proposal.id,
        payRevisionId: revision.id,
        compaRatioBefore: compaRatio(beforeAnnual, Number(band.midpointAnnual))?.toFixed(4) ?? null,
        compaRatioAfter: compaRatio(afterAnnual, Number(band.midpointAnnual))?.toFixed(4) ?? null,
        metadata: {
          compensationCycleId: cycle.id,
          compensationCycleName: cycle.name,
          reason: proposal.reason,
          workerEffectiveChangeId: proposal.workerEffectiveChangeId,
        },
        actorUserId,
        actorName: actor,
      }).returning();

      const [applied] = await tx.update(compensationProposals).set({
        status: "applied",
        appliedAt: now,
        failure: null,
        updatedAt: now,
      }).where(and(
        eq(compensationProposals.id, proposal.id),
        eq(compensationProposals.status, "scheduled"),
      )).returning();
      if (!applied) throw new Error("The compensation proposal changed before application.");

      // The salary profile, governing proposal, financial event, linked audit,
      // and secondary automation intents are ONE financial database commit.
      // Any audit failure reverts every write and preserves retryable salary.
      let audit;
      try {
        [audit] = await tx.insert(auditEvents).values({
          organizationId: proposal.organizationId,
          actor,
          action: "Scheduled compensation change applied",
          resource: `Employee #${proposal.employeeId}`,
          metadata: {
            proposalId: proposal.id,
            payRevisionId: revision.id,
            compensationEventId: event.id,
            compensationCycleId: cycle.id,
            effectiveDate: String(cycle.effectiveDate),
            previousAnnual: beforeAnnual,
            newAnnual: afterAnnual,
            workerEffectiveChangeId: proposal.workerEffectiveChangeId,
          },
        }).returning({ id: auditEvents.id });
      } catch {
        throw new ScheduledCompensationAuditWriteError();
      }

      // Persist the notification snapshots in the SAME financial commit.
      // Recovery never reads the worker's later mutable pay profile.
      try {
        await enqueueCompensationAutomationIntents(tx, {
          organizationId: proposal.organizationId,
          employeeId: proposal.employeeId,
          compensationEventId: event.id,
          intents: [
            {
              trigger: "compensation.changed",
              eventKey: `compensation-applied:${proposal.id}`,
              context: {
                compensationProposalId: proposal.id,
                compensationCycleId: cycle.id,
                effectiveDate: cycle.effectiveDate,
                previousAnnual: beforeAnnual,
                proposedAnnual: afterAnnual,
                eventAmount: afterAnnual - beforeAnnual,
                payRevisionId: revision.id,
                workerEffectiveChangeId: proposal.workerEffectiveChangeId,
              },
            },
            {
              trigger: "employee.field_changed",
              eventKey: `compensation-applied:${proposal.id}:field-change:annualsalary`,
              context: fieldChangeContext({
                field: "annualSalary",
                previousValue: beforeAnnual,
                newValue: afterAnnual,
                effectiveDate: String(cycle.effectiveDate),
                source: "compensation-governance",
                metadata: {
                  compensationProposalId: proposal.id,
                  compensationCycleId: cycle.id,
                  payRevisionId: revision.id,
                },
              }),
            },
            {
              trigger: "employee.field_changed",
              eventKey: `compensation-applied:${proposal.id}:field-change:monthlyequivalentsalary`,
              context: fieldChangeContext({
                field: "monthlyEquivalentSalary",
                previousValue: beforeAnnual / 12,
                newValue: afterAnnual / 12,
                effectiveDate: String(cycle.effectiveDate),
                source: "compensation-governance",
                metadata: {
                  compensationProposalId: proposal.id,
                  compensationCycleId: cycle.id,
                  payRevisionId: revision.id,
                },
              }),
            },
          ],
        });
      } catch {
        // Lost notification intent is an infrastructure failure, not a
        // rejected/invalid salary proposal. The enclosing tx rolls back pay.
        throw new ScheduledCompensationIntentWriteError();
      }

      return { skipped: false as const, proposal: applied, employee, revision, cycle, band, event, audit, beforeAnnual, afterAnnual };
    });
  } catch (error) {
    if (!(error instanceof ScheduledCompensationAuditWriteError)
        && !(error instanceof ScheduledCompensationIntentWriteError)) {
      // Domain failures need financial reviewer attention. Infrastructure
      // evidence failures rolled back all pay and remain scheduled for retry.
      const message = error instanceof Error ? error.message : "Unknown compensation application failure.";
      await db.update(compensationProposals).set({
        status: "failed",
        failure: message.slice(0, 4000),
        updatedAt: now,
      }).where(and(
        eq(compensationProposals.id, proposalId),
        eq(compensationProposals.status, "scheduled"),
      ));
    }
    throw error;
  }

  if (result.skipped) return result;

  const warnings: string[] = [];

  // Optimistic immediate handoff. Even if this call fails after commit, the
  // scheduler can deliver the transactionally persisted intent later.
  let automationDispatch: Awaited<ReturnType<typeof dispatchCompensationAutomationEvent>> | null = null;
  try {
    automationDispatch = await dispatchCompensationAutomationEvent({
      organizationId: result.proposal.organizationId,
      compensationEventId: result.event.id,
    });
    if (automationDispatch.retry > 0) warnings.push("Compensation notification delivery queued for retry.");
    if (automationDispatch.needsReview > 0) warnings.push("Compensation notification requires automation execution review.");
  } catch {
    warnings.push("Compensation notification delivery deferred to durable scheduler queue.");
  }

  return { ...result, automationDispatch, warnings };
}


export type RecurringCompensationDecision = "approve" | "decline" | "cancel";

/**
 * Same-day approvals and scheduled activations must persist identical
 * notification snapshots in the same commit as the financial event.
 */
function recurringActivationIntents(
  assignment: typeof employeeCompensationComponents.$inferSelect,
) {
  return [
        {
          trigger: "compensation.changed",
          eventKey: `compensation-component-active:${assignment.id}`,
          context: {
            compensationComponentAssignmentId: assignment.id,
            compensationComponentId: assignment.componentId,
            effectiveDate: assignment.effectiveFrom,
            eventAmount: Number(assignment.amount),
            compensationChangeKind: "recurring_component",
          },
        },
        {
          trigger: "employee.field_changed",
          eventKey: `compensation-component-active:${assignment.id}:field-change:recurringcompensationamount`,
          context: fieldChangeContext({
            field: "recurringCompensationAmount",
            previousValue: 0,
            newValue: Number(assignment.amount),
            effectiveDate: String(assignment.effectiveFrom),
            source: "compensation-component",
            metadata: {
              compensationComponentAssignmentId: assignment.id,
              compensationComponentId: assignment.componentId,
            },
          }),
        },
  ];

}


/**
 * Recurring compensation is already read by payroll when scheduled, so a
 * status change and every affected payroll reset must commit together.
 *
 * The same (4222, assignmentId) transaction lock is held by the activation
 * scheduler. Authorization/scope are checked in the route and the authoritative
 * tenant, maker-checker, date and status conditions are rechecked here.
 */
export async function decideRecurringCompensationComponent(input: {
  assignmentId: number;
  organizationId: number;
  employeeId: number;
  decision: RecurringCompensationDecision;
  actorUserId: number;
  actorName: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const today = philippineBusinessDate(now);

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(4222, ${input.assignmentId})`);

    const [current] = await tx.select().from(employeeCompensationComponents).where(and(
      eq(employeeCompensationComponents.id, input.assignmentId),
      eq(employeeCompensationComponents.organizationId, input.organizationId),
      eq(employeeCompensationComponents.employeeId, input.employeeId),
    )).limit(1);
    if (!current) throw new Error("COMPONENT_ASSIGNMENT_STALE");

    const [worker] = await tx.select({ orgUnitId: employees.orgUnitId }).from(employees).where(and(
      eq(employees.id, current.employeeId),
      eq(employees.organizationId, current.organizationId),
    )).limit(1);
    if (!worker) throw new Error("COMPONENT_EMPLOYEE_STALE");

    const effectiveFrom = String(current.effectiveFrom);
    const effectiveUntil = current.effectiveUntil ? String(current.effectiveUntil) : null;
    let nextStatus: "active" | "scheduled" | "declined" | "cancelled";

    if (input.decision === "approve") {
      if (current.status !== "pending_approval") throw new Error("COMPONENT_ASSIGNMENT_STALE");
      if (current.requestedByUserId === input.actorUserId) throw new Error("COMPONENT_MAKER_CHECKER_CONFLICT");
      if (effectiveFrom < today) throw new Error("COMPONENT_APPROVAL_RETROACTIVE");
      nextStatus = effectiveFrom <= today ? "active" : "scheduled";
    } else if (input.decision === "decline") {
      if (current.status !== "pending_approval") throw new Error("COMPONENT_ASSIGNMENT_STALE");
      nextStatus = "declined";
    } else {
      if (current.status !== "pending_approval" && current.status !== "scheduled") {
        throw new Error("COMPONENT_ASSIGNMENT_STALE");
      }
      // Scheduled rows are payroll-visible on the original effective date,
      // even before the activation scheduler runs. Past changes need a signed
      // correction/retro workflow, not a silent cancellation.
      if (current.status === "scheduled" && effectiveFrom <= today) {
        throw new Error("COMPONENT_CANCELLATION_RETROACTIVE");
      }
      nextStatus = "cancelled";
    }

    let invalidatedPayrollRunIds: number[] = [];
    if (input.decision === "approve" || (input.decision === "cancel" && current.status === "scheduled")) {
      const affectedRuns = await compensationPayrollConflicts({
        organizationId: current.organizationId,
        employeeOrgUnitId: worker.orgUnitId,
        effectiveFrom,
        effectiveUntil,
      }, tx);
      invalidatedPayrollRunIds = await invalidatePayrollRunsForCompensationChange(
        current.organizationId,
        affectedRuns,
        tx,
      );
    }

    const mutation = input.decision === "approve"
      ? {
          status: nextStatus,
          approvedByUserId: input.actorUserId,
          approvedBy: input.actorName,
          approvedAt: now,
          activatedAt: nextStatus === "active" ? now : null,
          updatedAt: now,
        }
      : input.decision === "decline"
        ? {
            status: nextStatus,
            approvedByUserId: input.actorUserId,
            approvedBy: input.actorName,
            approvedAt: now,
            updatedAt: now,
          }
        : {
            status: nextStatus,
            cancelledByUserId: input.actorUserId,
            cancelledBy: input.actorName,
            cancelledAt: now,
            updatedAt: now,
          };

    const [updated] = await tx.update(employeeCompensationComponents).set(mutation).where(and(
      eq(employeeCompensationComponents.id, current.id),
      eq(employeeCompensationComponents.organizationId, current.organizationId),
      eq(employeeCompensationComponents.status, current.status),
    )).returning();
    if (!updated) throw new Error("COMPONENT_ASSIGNMENT_STALE");

    let compensationEventId: number | null = null;
    if (input.decision !== "decline") {
      const [financialEvent] = await tx.insert(compensationEvents).values({
        organizationId: updated.organizationId,
        employeeId: updated.employeeId,
        eventType: input.decision === "approve"
          ? nextStatus === "active" ? "component_activated" : "component_scheduled"
          : "component_cancelled",
        effectiveDate: effectiveFrom,
        componentAssignmentId: updated.id,
        metadata: {
          componentId: updated.componentId,
          amount: Number(updated.amount),
          effectiveUntil: updated.effectiveUntil,
          reason: updated.reason,
          invalidatedPayrollRunIds,
        },
        actorUserId: input.actorUserId,
        actorName: input.actorName,
      }).returning({ id: compensationEvents.id });
      compensationEventId = financialEvent.id;

      // Effective-today approval is already ACTIVE. It will never visit the
      // scheduled-activation worker, so snapshot its two notification intents
      // now; a failed insert must roll the approval, payroll reset, and audit
      // back together.
      if (input.decision === "approve" && nextStatus === "active") {
        await enqueueCompensationAutomationIntents(tx, {
          organizationId: updated.organizationId,
          employeeId: updated.employeeId,
          compensationEventId: financialEvent.id,
          intents: recurringActivationIntents(updated),
        });
      }
    }

    const auditAction = input.decision === "approve"
      ? nextStatus === "active"
        ? "Recurring compensation component approved and activated"
        : "Recurring compensation component approved and scheduled"
      : input.decision === "decline"
        ? "Recurring compensation component declined"
        : "Recurring compensation component cancelled";
    await tx.insert(auditEvents).values({
      organizationId: updated.organizationId,
      actor: input.actorName,
      action: auditAction,
      resource: "Employee #" + updated.employeeId,
      metadata: {
        componentAssignmentId: updated.id,
        componentId: updated.componentId,
        effectiveFrom,
        decision: input.decision,
        invalidatedPayrollRunIds,
        compensationEventId,
      },
    });

    return { assignment: updated, nextStatus, invalidatedPayrollRunIds };
  });
}

export async function activateCompensationComponentAssignment(
  assignmentId: number,
  options: { actor?: string; actorUserId?: number | null; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  const today = philippineBusinessDate(now);
  const actor = options.actor ?? "System scheduler";
  const actorUserId = options.actorUserId ?? null;

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(4222, ${assignmentId})`);
    const [assignment] = await tx.select().from(employeeCompensationComponents)
      .where(eq(employeeCompensationComponents.id, assignmentId))
      .limit(1);
    if (!assignment) return { skipped: true as const, reason: "missing" as const };
    if (assignment.status === "active") return { skipped: true as const, reason: "already_active" as const };
    if (assignment.status !== "scheduled") return { skipped: true as const, reason: "not_scheduled" as const };
    if (String(assignment.effectiveFrom) > today) return { skipped: true as const, reason: "not_due" as const };

    const [active] = await tx.update(employeeCompensationComponents).set({
      status: "active",
      activatedAt: now,
      updatedAt: now,
    }).where(and(
      eq(employeeCompensationComponents.id, assignment.id),
      eq(employeeCompensationComponents.status, "scheduled"),
    )).returning();
    if (!active) return { skipped: true as const, reason: "claimed" as const };

    const [event] = await tx.insert(compensationEvents).values({
      organizationId: active.organizationId,
      employeeId: active.employeeId,
      eventType: "component_activated",
      effectiveDate: String(active.effectiveFrom),
      componentAssignmentId: active.id,
      metadata: {
        componentId: active.componentId,
        amount: Number(active.amount),
        effectiveUntil: active.effectiveUntil,
        reason: active.reason,
      },
      actorUserId,
      actorName: actor,
    }).returning();

    // A successful activation must have BOTH financial and operational audit
    // evidence. Any audit insert error rolls the activation and event back,
    // leaving the scheduled component eligible for a governed retry.
    const [audit] = await tx.insert(auditEvents).values({
      organizationId: active.organizationId,
      actor,
      action: "Recurring compensation component activated",
      resource: `Employee #${active.employeeId}`,
      metadata: {
        componentAssignmentId: active.id,
        componentId: active.componentId,
        compensationEventId: event.id,
        effectiveFrom: String(active.effectiveFrom),
        effectiveUntil: active.effectiveUntil,
        amount: Number(active.amount),
        previousStatus: "scheduled",
        activatedOnPhilippineDate: today,
      },
    }).returning({ id: auditEvents.id });

    await enqueueCompensationAutomationIntents(tx, {
      organizationId: active.organizationId,
      employeeId: active.employeeId,
      compensationEventId: event.id,
      intents: recurringActivationIntents(active),
    });

    return { skipped: false as const, assignment: active, event, audit };
  });

  if (result.skipped) return result;

  const warnings: string[] = [];
  let automationDispatch: Awaited<ReturnType<typeof dispatchCompensationAutomationEvent>> | null = null;
  try {
    automationDispatch = await dispatchCompensationAutomationEvent({
      organizationId: result.assignment.organizationId,
      compensationEventId: result.event.id,
    });
    if (automationDispatch.retry > 0) warnings.push("Recurring component notification queued for retry.");
    if (automationDispatch.needsReview > 0) warnings.push("Recurring component notification needs execution review.");
  } catch {
    warnings.push("Recurring component notification deferred to durable scheduler queue.");
  }

  return { ...result, automationDispatch, warnings };
}

/**
 * Close a recurring compensation component strictly AFTER its last payable
 * Philippine calendar day. Assignment-level lock 4222 is shared with the
 * approval/cancellation decision and scheduled-activation workflows.
 *
 * Status, compensation evidence and operational audit are one transaction.
 * If any evidence write fails, the assignment stays active for safe retry.
 * The ended status remains eligible for historical payroll recalculation only
 * within the assignment's approved effective-date interval.
 */
export async function expireCompensationComponentAssignment(
  assignmentId: number,
  options: { actor?: string; actorUserId?: number | null; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  const today = philippineBusinessDate(now);
  const actor = options.actor ?? "System scheduler";
  const actorUserId = options.actorUserId ?? null;

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(4222, ${assignmentId})`);
    const [assignment] = await tx.select().from(employeeCompensationComponents)
      .where(eq(employeeCompensationComponents.id, assignmentId))
      .limit(1);

    if (!assignment) return { skipped: true as const, reason: "missing" as const };
    if (assignment.status === "ended") return { skipped: true as const, reason: "already_ended" as const };
    if (assignment.status !== "active") return { skipped: true as const, reason: "not_active" as const };
    if (!assignment.effectiveUntil || String(assignment.effectiveUntil) >= today) {
      return { skipped: true as const, reason: "not_expired" as const };
    }

    const [closed] = await tx.update(employeeCompensationComponents).set({
      status: "ended",
      updatedAt: now,
    }).where(and(
      eq(employeeCompensationComponents.id, assignment.id),
      eq(employeeCompensationComponents.organizationId, assignment.organizationId),
      eq(employeeCompensationComponents.status, "active"),
      lt(employeeCompensationComponents.effectiveUntil, today),
    )).returning();
    if (!closed) return { skipped: true as const, reason: "claimed" as const };

    const effectiveUntil = String(closed.effectiveUntil);
    const evidence = {
      componentId: closed.componentId,
      amount: Number(closed.amount),
      effectiveFrom: String(closed.effectiveFrom),
      effectiveUntil,
      endedOnPhilippineDate: today,
      reason: closed.reason,
      previousStatus: "active",
    };
    // The event is effective on the last payable day; the operational end
    // is observed on the following Philippine business date or later.
    const [event] = await tx.insert(compensationEvents).values({
      organizationId: closed.organizationId,
      employeeId: closed.employeeId,
      eventType: "component_ended",
      effectiveDate: effectiveUntil,
      componentAssignmentId: closed.id,
      metadata: evidence,
      actorUserId,
      actorName: actor,
    }).returning({ id: compensationEvents.id });

    const [audit] = await tx.insert(auditEvents).values({
      organizationId: closed.organizationId,
      actor,
      action: "Recurring compensation component ended",
      resource: `Employee #${closed.employeeId}`,
      metadata: {
        componentAssignmentId: closed.id,
        employeeId: closed.employeeId,
        compensationEventId: event.id,
        ...evidence,
      },
    }).returning({ id: auditEvents.id });

    return { skipped: false as const, assignment: closed, event, audit };
  });
}

export async function runScheduledCompensationGovernance({
  actor = "System scheduler",
  now = new Date(),
  limit = 100,
}: {
  actor?: string;
  now?: Date;
  limit?: number;
} = {}) {
  const today = philippineBusinessDate(now);

  const dueProposals = await db.select({ id: compensationProposals.id })
    .from(compensationProposals)
    .innerJoin(compensationCycles, eq(compensationProposals.cycleId, compensationCycles.id))
    .where(and(
      eq(compensationProposals.status, "scheduled"),
      lte(compensationCycles.effectiveDate, today),
    ))
    .limit(Math.max(1, Math.min(limit, 100)));

  const proposalResults: Array<Record<string, unknown>> = [];
  for (const row of dueProposals) {
    try {
      const result = await applyScheduledCompensationProposal(row.id, { actor, now });
      proposalResults.push({
        id: row.id,
        status: result.skipped ? "skipped" : "applied",
        reason: result.skipped ? result.reason : undefined,
        ...(!result.skipped && result.warnings.length > 0 ? { warnings: result.warnings } : {}),
      });
    } catch (error) {
      proposalResults.push({
        id: row.id,
        status: error instanceof ScheduledCompensationAuditWriteError
          || error instanceof ScheduledCompensationIntentWriteError ? "retryable" : "failed",
        error: error instanceof Error ? error.message : "Unknown failure",
      });
    }
  }

  const dueComponents = await db.select({ id: employeeCompensationComponents.id })
    .from(employeeCompensationComponents)
    .where(and(
      eq(employeeCompensationComponents.status, "scheduled"),
      lte(employeeCompensationComponents.effectiveFrom, today),
    ))
    .limit(Math.max(1, Math.min(limit, 100)));

  const componentResults: Array<Record<string, unknown>> = [];
  for (const row of dueComponents) {
    try {
      const result = await activateCompensationComponentAssignment(row.id, { actor, now });
      componentResults.push({
        id: row.id,
        status: result.skipped ? "skipped" : "active",
        reason: result.skipped ? result.reason : undefined,
        ...(!result.skipped && result.warnings.length > 0 ? { warnings: result.warnings } : {}),
      });
    } catch (error) {
      componentResults.push({ id: row.id, status: "failed", error: error instanceof Error ? error.message : "Unknown failure" });
    }
  }

  const expired = await db.select({ id: employeeCompensationComponents.id })
    .from(employeeCompensationComponents)
    .where(and(
      eq(employeeCompensationComponents.status, "active"),
      lt(employeeCompensationComponents.effectiveUntil, today),
    ))
    .orderBy(asc(employeeCompensationComponents.id))
    .limit(Math.max(1, Math.min(limit, 100)));

  const ended: number[] = [];
  const expirationFailures: Array<{ id: number; error: string }> = [];
  for (const assignment of expired) {
    try {
      const result = await expireCompensationComponentAssignment(assignment.id, { actor, now });
      if (!result.skipped) ended.push(result.assignment.id);
    } catch (error) {
      // A failed evidence insert must not interrupt expiration of other
      // assignments. The rolled-back row remains active and is retried later.
      expirationFailures.push({
        id: assignment.id,
        error: error instanceof Error ? error.message : "Unknown expiration failure",
      });
    }
  }

  return { proposals: proposalResults, components: componentResults, ended, expirationFailures };
}
