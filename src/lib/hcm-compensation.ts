import { and, eq, lte, or, sql } from "drizzle-orm";
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
import { recordAuditEvent } from "@/lib/audit";
import { runAutomationEventSafely } from "@/lib/automation";
import { runEmployeeFieldChangeAutomations } from "@/lib/automation-change-events";
import { annualizePay, compaRatio } from "@/lib/compensation";
import { resolvePayProfile } from "@/lib/pay-basis";

const BUSY_PAYROLL_STATUSES = new Set(["Queued", "Processing", "Recalculating", "Releasing"]);

// Allows a compensation decision and any impacted payroll invalidation to
// succeed or roll back together. A separate nested transaction would reset a
// payroll run even if the later proposal approval fails.
type CompensationTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * A missing financial audit is a transient storage failure, not a defective
 * salary proposal. The transaction rolls back and the scheduled proposal is
 * preserved so the next governed scheduler pass can retry safely.
 */
export class ScheduledCompensationAuditWriteError extends Error {
  constructor() {
    super("Scheduled salary application audit could not be saved. Salary was not changed; retry when audit storage recovers.");
    this.name = "ScheduledCompensationAuditWriteError";
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

      // Lock in the same proposal -> cycle -> worker order as cancellation.
      // Avoid applying a salary while the governing review cycle is changing.
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

      // Financial state, salary event and operational audit must commit as
      // one unit. A committed salary with missing audit linkage cannot be
      // repaired by blindly re-running a previously applied proposal.
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

      return { skipped: false as const, proposal: applied, employee, revision, cycle, band, event, audit, beforeAnnual, afterAnnual };
    });
  } catch (error) {
    // A failed audit insert rolled back EVERY financial write. Do not
    // poison an otherwise valid scheduled proposal with "failed": it must
    // remain available for governed retry once audit storage is healthy.
    if (!(error instanceof ScheduledCompensationAuditWriteError)) {
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

  let automation: Awaited<ReturnType<typeof runAutomationEventSafely>> = [];
  try {
    automation = await runAutomationEventSafely({
      organizationId: result.proposal.organizationId,
      employeeId: result.proposal.employeeId,
      trigger: "compensation.changed",
      eventKey: `compensation-applied:${result.proposal.id}`,
      context: {
        compensationProposalId: result.proposal.id,
        compensationCycleId: result.cycle.id,
        effectiveDate: result.cycle.effectiveDate,
        previousAnnual: result.beforeAnnual,
        proposedAnnual: result.afterAnnual,
        eventAmount: result.afterAnnual - result.beforeAnnual,
        payRevisionId: result.revision.id,
        workerEffectiveChangeId: result.proposal.workerEffectiveChangeId,
      },
    });
  } catch (error) {
    warnings.push(`automation: ${error instanceof Error ? error.message : "unknown failure"}`);
  }

  let fieldChangeAutomation: Awaited<ReturnType<typeof runEmployeeFieldChangeAutomations>> = [];
  try {
    fieldChangeAutomation = await runEmployeeFieldChangeAutomations({
    organizationId: result.proposal.organizationId,
    employeeId: result.proposal.employeeId,
    eventKey: `compensation-applied:${result.proposal.id}:field-change`,
    changes: [
      {
        field: "annualSalary",
        previousValue: result.beforeAnnual,
        newValue: result.afterAnnual,
        effectiveDate: String(result.cycle.effectiveDate),
        source: "compensation-governance",
        metadata: {
          compensationProposalId: result.proposal.id,
          compensationCycleId: result.cycle.id,
          payRevisionId: result.revision.id,
        },
      },
      {
        field: "monthlyEquivalentSalary",
        previousValue: result.beforeAnnual / 12,
        newValue: result.afterAnnual / 12,
        effectiveDate: String(result.cycle.effectiveDate),
        source: "compensation-governance",
        metadata: {
          compensationProposalId: result.proposal.id,
          compensationCycleId: result.cycle.id,
          payRevisionId: result.revision.id,
        },
      },
    ],
    });
  } catch (error) {
    // The pay and its audit have already committed. Secondary automation
    // errors must not be presented as failed or rolled-back salary changes.
    warnings.push(`field-change automation: ${error instanceof Error ? error.message : "unknown failure"}`);
  }

  return { ...result, automation, fieldChangeAutomation, warnings };
}


export type RecurringCompensationDecision = "approve" | "decline" | "cancel";

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

    if (input.decision !== "decline") {
      await tx.insert(compensationEvents).values({
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
      });
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

    return { skipped: false as const, assignment: active, event };
  });

  if (result.skipped) return result;

  const warnings: string[] = [];
  try {
    await recordAuditEvent({
      organizationId: result.assignment.organizationId,
      actor,
      action: "Recurring compensation component activated",
      resource: `Employee #${result.assignment.employeeId}`,
      metadata: {
        componentAssignmentId: result.assignment.id,
        componentId: result.assignment.componentId,
        effectiveFrom: result.assignment.effectiveFrom,
        amount: Number(result.assignment.amount),
      },
    });
  } catch (error) {
    warnings.push(`audit: ${error instanceof Error ? error.message : "unknown failure"}`);
  }

  let automation: Awaited<ReturnType<typeof runAutomationEventSafely>> = [];
  try {
    automation = await runAutomationEventSafely({
      organizationId: result.assignment.organizationId,
      employeeId: result.assignment.employeeId,
      trigger: "compensation.changed",
      eventKey: `compensation-component-active:${result.assignment.id}`,
      context: {
        compensationComponentAssignmentId: result.assignment.id,
        compensationComponentId: result.assignment.componentId,
        effectiveDate: result.assignment.effectiveFrom,
        eventAmount: Number(result.assignment.amount),
        compensationChangeKind: "recurring_component",
      },
    });
  } catch (error) {
    warnings.push(`automation: ${error instanceof Error ? error.message : "unknown failure"}`);
  }

  const fieldChangeAutomation = await runEmployeeFieldChangeAutomations({
    organizationId: result.assignment.organizationId,
    employeeId: result.assignment.employeeId,
    eventKey: `compensation-component-active:${result.assignment.id}:field-change`,
    changes: [{
      field: "recurringCompensationAmount",
      previousValue: 0,
      newValue: Number(result.assignment.amount),
      effectiveDate: String(result.assignment.effectiveFrom),
      source: "compensation-component",
      metadata: {
        compensationComponentAssignmentId: result.assignment.id,
        compensationComponentId: result.assignment.componentId,
      },
    }],
  });

  return { ...result, automation, fieldChangeAutomation, warnings };
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
      proposalResults.push({ id: row.id, status: "failed", error: error instanceof Error ? error.message : "Unknown failure" });
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
      componentResults.push({ id: row.id, status: result.skipped ? "skipped" : "active", reason: result.skipped ? result.reason : undefined });
    } catch (error) {
      componentResults.push({ id: row.id, status: "failed", error: error instanceof Error ? error.message : "Unknown failure" });
    }
  }

  const expired = await db.select().from(employeeCompensationComponents).where(and(
    eq(employeeCompensationComponents.status, "active"),
    or(
      eq(employeeCompensationComponents.effectiveUntil, today),
      sql`${employeeCompensationComponents.effectiveUntil} < ${today}`,
    ),
  ));

  const ended: number[] = [];
  for (const assignment of expired) {
    if (!assignment.effectiveUntil || String(assignment.effectiveUntil) >= today) continue;
    const [closed] = await db.update(employeeCompensationComponents).set({
      status: "ended",
      updatedAt: now,
    }).where(and(
      eq(employeeCompensationComponents.id, assignment.id),
      eq(employeeCompensationComponents.status, "active"),
    )).returning();
    if (!closed) continue;
    ended.push(closed.id);
    await db.insert(compensationEvents).values({
      organizationId: closed.organizationId,
      employeeId: closed.employeeId,
      eventType: "component_ended",
      effectiveDate: String(closed.effectiveUntil),
      componentAssignmentId: closed.id,
      metadata: { componentId: closed.componentId, amount: Number(closed.amount) },
      actorName: actor,
    });
  }

  return { proposals: proposalResults, components: componentResults, ended };
}
