import { and, asc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents,
  automationEventLog,
  automationExecutions,
  compensationAutomationIntents,
} from "@/db/schema";
import { runAutomationEvent } from "@/lib/automation";

type OutboxTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type CompensationAutomationTrigger = "compensation.changed" | "employee.field_changed";

export type CompensationAutomationIntentInput = {
  trigger: CompensationAutomationTrigger;
  eventKey: string;
  context: Record<string, unknown>;
};

const MAX_AUTO_ATTEMPTS = 5;
const DISPATCH_LEASE_MS = 10 * 60 * 1000;

/**
 * These records MUST be inserted using the same transaction that makes a
 * compensation event financially effective. Callers may not use a separate
 * transaction or try to rebuild intent contexts from later mutable pay state.
 */
export async function enqueueCompensationAutomationIntents(
  tx: OutboxTransaction,
  input: {
    organizationId: number;
    employeeId: number;
    compensationEventId: number;
    intents: readonly CompensationAutomationIntentInput[];
  },
) {
  if (input.intents.length === 0) throw new Error("Compensation automation requires at least one intent.");
  if (input.intents.some((intent) =>
    !intent.eventKey || intent.eventKey.length > 240
    || !["compensation.changed", "employee.field_changed"].includes(intent.trigger)
  )) {
    throw new Error("Compensation automation event key or trigger is invalid.");
  }

  return tx.insert(compensationAutomationIntents).values(input.intents.map((intent) => ({
    organizationId: input.organizationId,
    employeeId: input.employeeId,
    compensationEventId: input.compensationEventId,
    trigger: intent.trigger,
    eventKey: intent.eventKey,
    context: intent.context,
  }))).returning({ id: compensationAutomationIntents.id });
}

export function compensationAutomationRetryDelayMs(attempt: number) {
  const bounded = Math.max(1, Math.min(Math.floor(attempt), MAX_AUTO_ATTEMPTS));
  return Math.min(60 * 60 * 1000, 60 * 1000 * 2 ** (bounded - 1));
}

type DispatchResult = { id: number; status: "dispatched" | "retry" | "needs_review" | "skipped"; reason?: string };

async function automationLedgerSeen(row: {
  organizationId: number;
  trigger: string;
  eventKey: string;
}) {
  const [seen] = await db.select({ id: automationEventLog.id })
    .from(automationEventLog).where(and(
      eq(automationEventLog.organizationId, row.organizationId),
      eq(automationEventLog.trigger, row.trigger),
      eq(automationEventLog.eventKey, row.eventKey),
    )).limit(1);
  return Boolean(seen);
}

async function persistDispatchResult(
  row: typeof compensationAutomationIntents.$inferSelect,
  status: "dispatched" | "retry" | "needs_review",
  input: { now: Date; error?: string; retryAt?: Date },
): Promise<DispatchResult> {
  const [updated] = await db.update(compensationAutomationIntents).set({
    status,
    leaseUntil: null,
    lastError: input.error?.slice(0, 4000) ?? null,
    ...(status === "retry" ? { nextAttemptAt: input.retryAt ?? input.now } : {}),
    ...(status === "dispatched" ? { dispatchedAt: input.now } : {}),
    updatedAt: input.now,
  }).where(and(
    eq(compensationAutomationIntents.id, row.id),
    eq(compensationAutomationIntents.organizationId, row.organizationId),
    eq(compensationAutomationIntents.status, "leased"),
    eq(compensationAutomationIntents.attempts, row.attempts),
  )).returning({ id: compensationAutomationIntents.id });
  // Another operator may have quarantined a stale lease. Never overwrite that
  // disposition, and NEVER replay an external action as compensation itself.
  return updated ? { id: row.id, status } : { id: row.id, status: "skipped", reason: "lease_changed" };
}

/**
 * At-least-once attempt to hand off to the existing *idempotent* automation
 * engine, but never blind replay after a ledger footprint or uncertain crash.
 * Existing execution-level failed-step recovery remains a human-governed path.
 */
export async function dispatchCompensationAutomationIntent(
  id: number,
  now = new Date(),
): Promise<DispatchResult> {
  const [row] = await db.update(compensationAutomationIntents).set({
    status: "leased",
    attempts: sql`${compensationAutomationIntents.attempts} + 1`,
    leaseUntil: new Date(now.getTime() + DISPATCH_LEASE_MS),
    updatedAt: now,
  }).where(and(
    eq(compensationAutomationIntents.id, id),
    inArray(compensationAutomationIntents.status, ["pending", "retry"]),
    lte(compensationAutomationIntents.nextAttemptAt, now),
  )).returning();
  if (!row) return { id, status: "skipped", reason: "not_due_or_already_claimed" };

  try {
    // A previous worker might have begun running the rule but crashed before
    // confirming the outbox row. Such events require investigation, not replay.
    if (await automationLedgerSeen(row)) {
      return persistDispatchResult(row, "needs_review", {
        now, error: "Automation ledger already exists before delivery; verify prior execution before any manual replay.",
      });
    }

    const outcomes = await runAutomationEvent({
      organizationId: row.organizationId,
      employeeId: row.employeeId,
      trigger: row.trigger as CompensationAutomationTrigger,
      eventKey: row.eventKey,
      context: row.context as Record<string, unknown>,
    });
    if (outcomes.some((outcome) =>
      !["completed", "waiting", "waiting_approval"].includes(outcome.status)
    )) {
      return persistDispatchResult(row, "needs_review", {
        now, error: "Automation engine reported incomplete or previously claimed rule execution. Inspect Automation Studio execution evidence.",
      });
    }
    return persistDispatchResult(row, "dispatched", { now });
  } catch {
    // Only failures that occurred BEFORE the event ledger was written may be
    // retried automatically. Once the engine reached that ledger, steps might
    // have external effects and must use the manual dead-letter workflow.
    let ledgerExists = true;
    try { ledgerExists = await automationLedgerSeen(row); } catch { /* conservative */ }
    if (ledgerExists || row.attempts >= MAX_AUTO_ATTEMPTS) {
      return persistDispatchResult(row, "needs_review", {
        now,
        error: ledgerExists
          ? "Dispatch failed after an automation event might have executed. Inspect execution evidence; no automatic replay."
          : "Maximum pre-ledger retry attempts reached. Human reconciliation required.",
      });
    }
    return persistDispatchResult(row, "retry", {
      now,
      error: "Pre-ledger automation dispatch error; retry scheduled.",
      retryAt: new Date(now.getTime() + compensationAutomationRetryDelayMs(row.attempts)),
    });
  }
}

/**
 * Opportunistic dispatch after financial commit. If the process dies before
 * this call, the scheduler still has the durable intents. The result only
 * contains IDs and statuses, never immutable pay-context snapshots.
 */
export async function dispatchCompensationAutomationEvent(input: {
  organizationId: number;
  compensationEventId: number;
}) {
  const intents = await db.select({ id: compensationAutomationIntents.id })
    .from(compensationAutomationIntents).where(and(
      eq(compensationAutomationIntents.organizationId, input.organizationId),
      eq(compensationAutomationIntents.compensationEventId, input.compensationEventId),
    )).orderBy(asc(compensationAutomationIntents.id)).limit(10);
  const results: DispatchResult[] = [];
  for (const intent of intents) {
    results.push(await dispatchCompensationAutomationIntent(intent.id));
  }
  return {
    attempted: results.length,
    dispatched: results.filter((result) => result.status === "dispatched").length,
    retry: results.filter((result) => result.status === "retry").length,
    needsReview: results.filter((result) => result.status === "needs_review").length,
    results,
  };
}

/**
 * A crashed or hung leased worker is ambiguous even if the event log is not
 * visible yet. Quarantine rather than re-running a possibly live side effect.
 */
export async function quarantineExpiredCompensationAutomationLeases(
  now = new Date(), limit = 25,
) {
  const rows = await db.select({ id: compensationAutomationIntents.id })
    .from(compensationAutomationIntents)
    .where(and(
      eq(compensationAutomationIntents.status, "leased"),
      lte(compensationAutomationIntents.leaseUntil, now),
    ))
    .orderBy(asc(compensationAutomationIntents.id))
    .limit(Math.max(1, Math.min(limit, 100)));
  const quarantined: number[] = [];
  for (const row of rows) {
    const [updated] = await db.update(compensationAutomationIntents).set({
      status: "needs_review",
      leaseUntil: null,
      lastError: "Dispatch lease expired. External automation side effects are uncertain; human review required.",
      updatedAt: now,
    }).where(and(
      eq(compensationAutomationIntents.id, row.id),
      eq(compensationAutomationIntents.status, "leased"),
      lte(compensationAutomationIntents.leaseUntil, now),
    )).returning({ id: compensationAutomationIntents.id });
    if (updated) quarantined.push(updated.id);
  }
  return quarantined;
}

export async function drainCompensationAutomationIntents(
  now = new Date(), limit = 25,
) {
  const bounded = Math.max(1, Math.min(Math.trunc(limit), 100));
  const quarantined = await quarantineExpiredCompensationAutomationLeases(now, bounded);
  const due = await db.select({ id: compensationAutomationIntents.id })
    .from(compensationAutomationIntents)
    .where(and(
      inArray(compensationAutomationIntents.status, ["pending", "retry"]),
      lte(compensationAutomationIntents.nextAttemptAt, now),
    ))
    .orderBy(asc(compensationAutomationIntents.id))
    .limit(bounded);
  const results: DispatchResult[] = [];
  for (const row of due) {
    try {
      results.push(await dispatchCompensationAutomationIntent(row.id, now));
    } catch {
      // The durable row still exists. Scheduler should expose failures and
      // continue processing remaining intents instead of rewinding payroll.
      results.push({ id: row.id, status: "needs_review", reason: "dispatch_error_unconfirmed" });
    }
  }
  return {
    attempted: results.length,
    dispatched: results.filter((row) => row.status === "dispatched").length,
    retry: results.filter((row) => row.status === "retry").length,
    needsReview: results.filter((row) => row.status === "needs_review").length + quarantined.length,
    quarantined,
    results,
  };
}

/**
 * Read-only tenant-scoped operational review. No salary snapshot/context,
 * worker identity or provider information is returned through this interface.
 * Scan all pages before declaring the compensation queue reconciled.
 */
export async function inspectCompensationAutomationIntents(input: {
  organizationId: number;
  afterId?: number;
  limit?: number;
}) {
  const afterId = input.afterId ?? 0;
  const limit = input.limit ?? 100;
  if (!Number.isSafeInteger(input.organizationId) || input.organizationId <= 0
    || !Number.isSafeInteger(afterId) || afterId < 0
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 250) {
    throw new Error("Compensation queue audit requires a positive organizationId, nonnegative cursor and limit of 1-250.");
  }
  const rows = await db.select({
    id: compensationAutomationIntents.id,
    compensationEventId: compensationAutomationIntents.compensationEventId,
    trigger: compensationAutomationIntents.trigger,
    status: compensationAutomationIntents.status,
    attempts: compensationAutomationIntents.attempts,
    nextAttemptAt: compensationAutomationIntents.nextAttemptAt,
  }).from(compensationAutomationIntents).where(and(
    eq(compensationAutomationIntents.organizationId, input.organizationId),
    gt(compensationAutomationIntents.id, afterId),
  )).orderBy(asc(compensationAutomationIntents.id)).limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return {
    organizationId: input.organizationId,
    examined: page.length,
    pending: page.filter((row) => row.status === "pending").length,
    retry: page.filter((row) => row.status === "retry").length,
    dispatched: page.filter((row) => row.status === "dispatched").length,
    needsReview: page.filter((row) => row.status === "needs_review").length,
    leased: page.filter((row) => row.status === "leased").length,
    rows: page,
    nextCursor: hasMore ? page[page.length - 1].id : null,
    readOnly: true as const,
    financiallyCertified: false as const,
  };
}

/**
 * Operator-only recovery. A needs-review intent is re-queued only if no event
 * ledger or execution exists. Use with an independently authorized reviewer;
 * ambiguous event-ledger/execution states must go through Automation Studio.
 */
export async function retryUnstartedCompensationAutomationIntent(input: {
  organizationId: number;
  intentId: number;
  reviewer: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  if (!input.reviewer.trim()) throw new Error("A human reviewer is required.");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(4270, ${input.intentId})`);
    const [intent] = await tx.select().from(compensationAutomationIntents).where(and(
      eq(compensationAutomationIntents.id, input.intentId),
      eq(compensationAutomationIntents.organizationId, input.organizationId),
    )).limit(1);
    if (!intent || intent.status !== "needs_review") throw new Error("Compensation automation intent is not in review.");
    if (intent.lastError?.includes("lease expired")) {
      throw new Error("An expired dispatch lease may have external side effects; require separate execution evidence review.");
    }
    const [[event], [execution]] = await Promise.all([
      tx.select({ id: automationEventLog.id }).from(automationEventLog).where(and(
        eq(automationEventLog.organizationId, input.organizationId),
        eq(automationEventLog.trigger, intent.trigger),
        eq(automationEventLog.eventKey, intent.eventKey),
      )).limit(1),
      tx.select({ id: automationExecutions.id }).from(automationExecutions).where(and(
        eq(automationExecutions.organizationId, input.organizationId),
        eq(automationExecutions.trigger, intent.trigger),
        eq(automationExecutions.eventKey, intent.eventKey),
      )).limit(1),
    ]);
    if (event || execution) throw new Error("Automation may have run; use governed execution review instead of replay.");
    const [updated] = await tx.update(compensationAutomationIntents).set({
      status: "retry",
      attempts: 0,
      nextAttemptAt: now,
      leaseUntil: null,
      lastError: "Reviewer authorized a fresh pre-ledger retry.",
      updatedAt: now,
    }).where(and(
      eq(compensationAutomationIntents.id, intent.id),
      eq(compensationAutomationIntents.organizationId, input.organizationId),
      eq(compensationAutomationIntents.status, "needs_review"),
    )).returning();
    if (!updated) throw new Error("Compensation automation intent changed during review.");
    await tx.insert(auditEvents).values({
      organizationId: input.organizationId,
      actor: input.reviewer,
      action: "Compensation automation pre-ledger retry authorized",
      resource: `Compensation automation intent #${intent.id}`,
      metadata: {
        intentId: intent.id,
        compensationEventId: intent.compensationEventId,
        trigger: intent.trigger,
        eventKey: intent.eventKey,
        previousStatus: "needs_review",
      },
    });
    return { intentId: intent.id, status: "retry" as const };
  });
}
