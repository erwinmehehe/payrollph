import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents, employees, payrollEntries, payrollRuns,
  payoutBatches, payoutTransfers, payoutBatchTransfers,
} from "@/db/schema";
import {
  canonicalPayoutIntents, initialPayoutBatchKey, payoutBatchFingerprint,
  payoutCentsFromNetPay, type PayoutIntent,
} from "@/lib/payout-ledger-rules";

export type PreparedInitialPayoutBatch = {
  batchId: number;
  organizationId: number;
  payrollRunId: number;
  transferCount: number;
  totalAmountCents: number;
  idempotencyKey: string;
  requestHash: string;
};

/**
 * Stage the FIRST payment instruction for a released payroll run.
 *
 * No external calls are made. A durable run-row lock serializes preparation,
 * and immutable one-per-employee database constraints are the backstop.
 * Existing legacy audit evidence of payout blocks adoption of the ledger
 * without an individually approved historical reconciliation/backfill.
 */
export async function prepareInitialPayoutBatch(input: {
  organizationId: number;
  payrollRunId: number;
  intents: readonly PayoutIntent[];
}): Promise<PreparedInitialPayoutBatch> {
  if (!Number.isSafeInteger(input.organizationId) || input.organizationId <= 0
    || !Number.isSafeInteger(input.payrollRunId) || input.payrollRunId <= 0) {
    throw new Error("PAYOUT_INVALID_TENANT_OR_RUN");
  }
  const intents = canonicalPayoutIntents(input.intents);
  const totalAmountCents = intents.reduce((sum, row) => sum + row.amountCents, 0);
  const requestHash = payoutBatchFingerprint(intents);
  const idempotencyKey = initialPayoutBatchKey(input.payrollRunId);

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM payroll_runs WHERE id = ${input.payrollRunId} FOR UPDATE`);
    const [run] = await tx.select().from(payrollRuns).where(and(
      eq(payrollRuns.id, input.payrollRunId),
      eq(payrollRuns.organizationId, input.organizationId),
    )).limit(1);
    if (!run || run.status !== "Released") {
      throw new Error("PAYOUT_RELEASE_AND_TENANT_VERIFICATION_REQUIRED");
    }

    // A previous provider or manual submission must never be silently adopted
    // as a newly prepared payout. Reconcile its history separately.
    const priorProvider = await tx.select({ id: auditEvents.id }).from(auditEvents)
      .where(and(
        eq(auditEvents.organizationId, input.organizationId),
        inArray(auditEvents.action, [
          "Payroll payout submitted via PayMongo",
          "Payroll payout retry submitted via PayMongo",
          "Payroll payout completed via PayMongo",
          "Payroll payout completed manually",
        ]),
        sql`${auditEvents.metadata} ->> 'runId' = ${String(input.payrollRunId)}`,
      )).limit(1);
    if (priorProvider.length > 0) throw new Error("PAYOUT_EXISTING_LEGACY_PAYMENT_REQUIRES_RECONCILIATION");

    const existing = await tx.select({ id: payoutBatches.id }).from(payoutBatches)
      .where(and(
        eq(payoutBatches.organizationId, input.organizationId),
        eq(payoutBatches.payrollRunId, input.payrollRunId),
      )).limit(1);
    if (existing.length > 0) throw new Error("PAYOUT_BATCH_ALREADY_PREPARED");

    const sourceEntries = await tx.select({
      id: payrollEntries.id, employeeId: payrollEntries.employeeId, netPay: payrollEntries.netPay,
    }).from(payrollEntries).where(eq(payrollEntries.payrollRunId, input.payrollRunId));
    if (sourceEntries.length !== run.employeeCount) {
      throw new Error("PAYOUT_RELEASED_EMPLOYEE_COUNT_MISMATCH");
    }
    const wanted = new Map(intents.map((intent) => [intent.employeeId, intent]));
    const payableEntries = sourceEntries.filter((entry) => payoutCentsFromNetPay(entry.netPay) > 0);
    if (payableEntries.length !== intents.length) throw new Error("PAYOUT_FROZEN_ENTRY_SET_MISMATCH");
    for (const entry of payableEntries) {
      const requested = wanted.get(entry.employeeId);
      if (!requested || requested.payrollEntryId !== entry.id
        || requested.amountCents !== payoutCentsFromNetPay(entry.netPay)) {
        throw new Error("PAYOUT_FROZEN_ENTRY_AMOUNT_MISMATCH");
      }
    }
    if (payoutCentsFromNetPay(run.netPay) !== totalAmountCents) {
      throw new Error("PAYOUT_RELEASED_RUN_TOTAL_MISMATCH");
    }

    const roster = await tx.select({
      id: employees.id,
      employeeNo: employees.employeeNo,
      organizationId: employees.organizationId,
    }).from(employees).where(inArray(employees.id, intents.map((intent) => intent.employeeId)));
    if (roster.length !== intents.length) throw new Error("PAYOUT_EMPLOYEE_IDENTITY_MISSING");
    for (const employee of roster) {
      const intent = wanted.get(employee.id);
      if (employee.organizationId !== input.organizationId
        || !intent || intent.referenceNumber !== `PAY-${run.id}-${employee.employeeNo}`) {
        throw new Error("PAYOUT_TENANT_OR_REFERENCE_MISMATCH");
      }
    }

    const [batch] = await tx.insert(payoutBatches).values({
      organizationId: input.organizationId,
      payrollRunId: run.id,
      provider: "paymongo",
      idempotencyKey,
      requestHash,
      transferCount: intents.length,
      totalAmountCents,
      status: "prepared",
    }).returning({ id: payoutBatches.id });
    if (!batch) throw new Error("PAYOUT_BATCH_INSERT_FAILED");

    const transfers = await tx.insert(payoutTransfers).values(intents.map((intent) => ({
      organizationId: input.organizationId,
      payrollRunId: run.id,
      payrollEntryId: intent.payrollEntryId,
      employeeId: intent.employeeId,
      referenceNumber: intent.referenceNumber,
      amountCents: intent.amountCents,
      status: "prepared" as const,
    }))).returning({ id: payoutTransfers.id });
    if (transfers.length !== intents.length) throw new Error("PAYOUT_TRANSFER_INSERT_INCOMPLETE");

    await tx.insert(payoutBatchTransfers).values(transfers.map((transfer) => ({
      organizationId: input.organizationId,
      payoutBatchId: batch.id,
      payoutTransferId: transfer.id,
      status: "prepared" as const,
    })));
    await tx.insert(auditEvents).values({
      organizationId: input.organizationId,
      actor: "System",
      action: "Payroll payout batch staged (no funds sent)",
      resource: `payroll-run-${run.id}`,
      metadata: {
        runId: run.id,
        payoutBatchId: batch.id,
        transferCount: intents.length,
        totalAmountCents,
        requestHash,
        moneyMovedByLinaw: false,
      },
    });

    return {
      batchId: batch.id,
      organizationId: input.organizationId,
      payrollRunId: run.id,
      transferCount: intents.length,
      totalAmountCents,
      idempotencyKey,
      requestHash,
    };
  });
}

/**
 * One database winner may proceed with an externally approved submission.
 * This function does NOT invoke PayMongo. The claim transaction commits
 * BEFORE any future network request; a crash leaves status 'submitting',
 * requiring operator reconciliation rather than blind re-submission.
 */
export async function claimPreparedPayoutBatch(input: {
  organizationId: number;
  batchId: number;
}): Promise<PreparedInitialPayoutBatch | null> {
  if (!Number.isSafeInteger(input.organizationId) || input.organizationId <= 0
    || !Number.isSafeInteger(input.batchId) || input.batchId <= 0) {
    throw new Error("PAYOUT_INVALID_CLAIM");
  }
  return db.transaction(async (tx) => {
    const [batch] = await tx.update(payoutBatches)
      .set({ status: "submitting", claimedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(payoutBatches.id, input.batchId),
        eq(payoutBatches.organizationId, input.organizationId),
        eq(payoutBatches.status, "prepared"),
      )).returning();
    if (!batch) return null;

    const linked = await tx.select().from(payoutBatchTransfers).where(and(
      eq(payoutBatchTransfers.organizationId, input.organizationId),
      eq(payoutBatchTransfers.payoutBatchId, batch.id),
    ));
    if (linked.length !== batch.transferCount) throw new Error("PAYOUT_CLAIM_TRANSFER_COUNT_MISMATCH");
    for (const item of linked) {
      const [updated] = await tx.update(payoutTransfers)
        .set({ status: "submitting", updatedAt: new Date() })
        .where(and(
          eq(payoutTransfers.id, item.payoutTransferId),
          eq(payoutTransfers.organizationId, input.organizationId),
          eq(payoutTransfers.payrollRunId, batch.payrollRunId),
          eq(payoutTransfers.status, "prepared"),
        )).returning({ id: payoutTransfers.id });
      if (!updated) throw new Error("PAYOUT_TRANSFER_ALREADY_CLAIMED");
    }
    const updatedLinks = await tx.update(payoutBatchTransfers)
      .set({ status: "submitting", updatedAt: new Date() })
      .where(and(
        eq(payoutBatchTransfers.payoutBatchId, batch.id),
        eq(payoutBatchTransfers.organizationId, input.organizationId),
        eq(payoutBatchTransfers.status, "prepared"),
      )).returning({ id: payoutBatchTransfers.id });
    if (updatedLinks.length !== batch.transferCount) throw new Error("PAYOUT_BATCH_ITEMS_ALREADY_CLAIMED");

    return {
      batchId: batch.id, organizationId: batch.organizationId,
      payrollRunId: batch.payrollRunId, transferCount: batch.transferCount,
      totalAmountCents: batch.totalAmountCents,
      idempotencyKey: batch.idempotencyKey,
      requestHash: batch.requestHash,
    };
  });
}

/**
 * If a claimed request loses its provider response, the outcome is unknown.
 * Never relabel it as a failed transfer or reset it to prepared.
 */
export async function markPayoutBatchForReconciliation(input: {
  organizationId: number;
  batchId: number;
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [batch] = await tx.update(payoutBatches).set({
      status: "reconciliation_required",
      updatedAt: new Date(),
    }).where(and(
      eq(payoutBatches.id, input.batchId),
      eq(payoutBatches.organizationId, input.organizationId),
      eq(payoutBatches.status, "submitting"),
    )).returning({ id: payoutBatches.id });
    if (!batch) return false;
    const links = await tx.update(payoutBatchTransfers).set({
      status: "reconciliation_required", updatedAt: new Date(),
    }).where(and(
      eq(payoutBatchTransfers.organizationId, input.organizationId),
      eq(payoutBatchTransfers.payoutBatchId, input.batchId),
      eq(payoutBatchTransfers.status, "submitting"),
    )).returning({ payoutTransferId: payoutBatchTransfers.payoutTransferId });
    for (const item of links) {
      await tx.update(payoutTransfers).set({
        status: "reconciliation_required", updatedAt: new Date(),
      }).where(and(
        eq(payoutTransfers.organizationId, input.organizationId),
        eq(payoutTransfers.id, item.payoutTransferId),
        eq(payoutTransfers.status, "submitting"),
      ));
    }
    return true;
  });
}

/**
 * Persist an already received provider batch ACK atomically.
 * This function does NOT call PayMongo. It only accepts the complete,
 * exact reference/amount/transfer-ID set from a claimed batch.
 *
 * A successful HTTP response is NOT evidence of funds settled: even a
 * succeeded-looking batch remains 'submitted' until provider reconciliation.
 */
export async function recordPayoutProviderBatchResponse(input: {
  organizationId: number;
  batchId: number;
  providerBatchId: string;
  transfers: readonly {
    referenceNumber: string;
    amountCents: number;
    providerTransferId: string;
  }[];
}): Promise<boolean> {
  if (!Number.isSafeInteger(input.organizationId) || input.organizationId <= 0
    || !Number.isSafeInteger(input.batchId) || input.batchId <= 0
    || !/^batch_tr_[A-Za-z0-9_-]+$/.test(input.providerBatchId)) {
    throw new Error("PAYOUT_PROVIDER_ACK_INVALID");
  }
  const received = new Map<string, { amountCents: number; providerTransferId: string }>();
  const remoteIds = new Set<string>();
  for (const row of input.transfers) {
    if (typeof row.referenceNumber !== "string"
      || !Number.isSafeInteger(row.amountCents) || row.amountCents <= 0
      || typeof row.providerTransferId !== "string"
      || !/^[A-Za-z0-9_-]{3,160}$/.test(row.providerTransferId)
      || received.has(row.referenceNumber) || remoteIds.has(row.providerTransferId)) {
      throw new Error("PAYOUT_PROVIDER_ACK_DUPLICATE_OR_MALFORMED");
    }
    remoteIds.add(row.providerTransferId);
    received.set(row.referenceNumber, {
      amountCents: row.amountCents, providerTransferId: row.providerTransferId,
    });
  }

  return db.transaction(async (tx) => {
    const [batch] = await tx.select().from(payoutBatches).where(and(
      eq(payoutBatches.id, input.batchId),
      eq(payoutBatches.organizationId, input.organizationId),
    )).for("update");
    if (!batch || batch.status !== "submitting") return false;
    if (received.size !== batch.transferCount) throw new Error("PAYOUT_PROVIDER_ACK_COUNT_MISMATCH");

    const linked = await tx.select({
      linkId: payoutBatchTransfers.id,
      transferId: payoutTransfers.id,
      referenceNumber: payoutTransfers.referenceNumber,
      amountCents: payoutTransfers.amountCents,
      linkStatus: payoutBatchTransfers.status,
      transferStatus: payoutTransfers.status,
    }).from(payoutBatchTransfers)
      .innerJoin(payoutTransfers, eq(payoutBatchTransfers.payoutTransferId, payoutTransfers.id))
      .where(and(
        eq(payoutBatchTransfers.organizationId, input.organizationId),
        eq(payoutBatchTransfers.payoutBatchId, batch.id),
        eq(payoutTransfers.organizationId, input.organizationId),
        eq(payoutTransfers.payrollRunId, batch.payrollRunId),
      ));
    if (linked.length !== batch.transferCount) throw new Error("PAYOUT_PROVIDER_ACK_LEDGER_COUNT_MISMATCH");

    for (const row of linked) {
      const item = received.get(row.referenceNumber);
      if (!item || item.amountCents !== row.amountCents
        || row.linkStatus !== "submitting" || row.transferStatus !== "submitting") {
        throw new Error("PAYOUT_PROVIDER_ACK_IDENTITY_OR_STATE_MISMATCH");
      }
    }

    for (const row of linked) {
      const accepted = received.get(row.referenceNumber)!;
      await tx.update(payoutBatchTransfers).set({
        providerTransferId: accepted.providerTransferId,
        status: "submitted",
        updatedAt: new Date(),
      }).where(eq(payoutBatchTransfers.id, row.linkId));
      await tx.update(payoutTransfers).set({
        status: "submitted", updatedAt: new Date(),
      }).where(eq(payoutTransfers.id, row.transferId));
    }
    const [updated] = await tx.update(payoutBatches).set({
      providerBatchId: input.providerBatchId,
      status: "submitted", submittedAt: new Date(), updatedAt: new Date(),
    }).where(and(
      eq(payoutBatches.id, batch.id), eq(payoutBatches.status, "submitting"),
    )).returning({ id: payoutBatches.id });
    if (!updated) throw new Error("PAYOUT_PROVIDER_ACK_CLAIM_LOST");

    await tx.insert(auditEvents).values({
      organizationId: input.organizationId,
      actor: "System",
      action: "PayMongo payout batch acknowledged (settlement not verified)",
      resource: `payroll-run-${batch.payrollRunId}`,
      metadata: {
        runId: batch.payrollRunId,
        payoutBatchId: batch.id,
        providerBatchId: input.providerBatchId,
        transferCount: batch.transferCount,
        requestHash: batch.requestHash,
        settlementVerified: false,
      },
    });
    return true;
  });
}
