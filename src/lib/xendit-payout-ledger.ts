import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents, employees, payoutBatches, payoutTransfers,
  payoutBatchTransfers, providerEvents,
} from "@/db/schema";
import { xenditPayoutState } from "@/lib/xendit-payroll-payouts";

type Link = typeof payoutBatchTransfers.$inferSelect;
type Transfer = typeof payoutTransfers.$inferSelect;
type PayoutStatus = "prepared" | "submitting" | "submitted" |
  "succeeded" | "failed" | "reversed" | "reconciliation_required" | "cancelled";

export type XenditPayoutLedgerRow = {
  transferId: number;
  payrollEntryId: number;
  employeeNo: string;
  referenceNumber: string;
  amountCents: number;
  providerPayoutId: string | null;
  status: string;
};

const batchScope = (organizationId: number, payrollRunId: number) =>
  and(eq(payoutBatches.organizationId, organizationId), eq(payoutBatches.payrollRunId, payrollRunId));

async function linkedTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  batchId: number,
  organizationId: number,
) {
  return tx.select({
    link: payoutBatchTransfers,
    transfer: payoutTransfers,
    employeeNo: employees.employeeNo,
  }).from(payoutBatchTransfers)
    .innerJoin(payoutTransfers, eq(payoutTransfers.id, payoutBatchTransfers.payoutTransferId))
    .innerJoin(employees, eq(employees.id, payoutTransfers.employeeId))
    .where(and(
      eq(payoutBatchTransfers.payoutBatchId, batchId),
      eq(payoutBatchTransfers.organizationId, organizationId),
      eq(payoutTransfers.organizationId, organizationId),
      eq(employees.organizationId, organizationId),
    ))
    .orderBy(asc(payoutTransfers.id));
}

function toRow(row: { link: Link; transfer: Transfer; employeeNo: string }): XenditPayoutLedgerRow {
  return {
    transferId: row.transfer.id,
    payrollEntryId: row.transfer.payrollEntryId,
    employeeNo: row.employeeNo,
    referenceNumber: row.transfer.referenceNumber,
    amountCents: row.transfer.amountCents,
    providerPayoutId: row.link.providerTransferId,
    status: row.transfer.status,
  };
}

export async function xenditPayoutLedger(organizationId: number, payrollRunId: number) {
  const [batch] = await db.select().from(payoutBatches)
    .where(batchScope(organizationId, payrollRunId)).limit(1);
  if (!batch) return null;
  if (batch.provider !== "xendit") throw new Error("PAYROLL_PAYOUT_ALREADY_CLAIMED_BY_ANOTHER_PROVIDER");
  const records = await db.select({
    link: payoutBatchTransfers,
    transfer: payoutTransfers,
    employeeNo: employees.employeeNo,
  }).from(payoutBatchTransfers)
    .innerJoin(payoutTransfers, eq(payoutTransfers.id, payoutBatchTransfers.payoutTransferId))
    .innerJoin(employees, eq(employees.id, payoutTransfers.employeeId))
    .where(and(
      eq(payoutBatchTransfers.payoutBatchId, batch.id),
      eq(payoutBatchTransfers.organizationId, organizationId),
      eq(payoutTransfers.organizationId, organizationId),
      eq(employees.organizationId, organizationId),
    )).orderBy(asc(payoutTransfers.id));
  if (records.length !== batch.transferCount) throw new Error("PAYOUT_LEDGER_INCOMPLETE");
  const rows = records.map(toRow);
  const counts = {
    prepared: rows.filter((x) => x.status === "prepared").length,
    submitted: rows.filter((x) => x.status === "submitted").length,
    succeeded: rows.filter((x) => x.status === "succeeded").length,
    failed: rows.filter((x) => x.status === "failed").length,
    reversed: rows.filter((x) => x.status === "reversed").length,
    unknown: rows.filter((x) => ["submitting", "reconciliation_required"].includes(x.status)).length,
  };
  return { batchId: batch.id, provider: batch.provider, status: batch.status, totals: {
    amountCents: batch.totalAmountCents, transferCount: batch.transferCount,
  }, counts, rows };
}

/**
 * Claim one Xendit request before any network call. The payout batch is
 * global per payroll run, regardless of provider; no retry can bypass it.
 * A submitting/ambiguous row freezes the whole run until reconciled.
 */
export async function claimNextXenditPayout(input: {
  organizationId: number; payrollRunId: number;
}): Promise<XenditPayoutLedgerRow | null> {
  return db.transaction(async (tx) => {
    const [batch] = await tx.select().from(payoutBatches)
      .where(batchScope(input.organizationId, input.payrollRunId)).for("update");
    if (!batch || batch.provider !== "xendit") throw new Error("XENDIT_BATCH_NOT_PREPARED");
    if (batch.status === "submitted" || batch.status === "settled") return null;
    if (!["prepared", "submitting"].includes(batch.status)) {
      throw new Error("XENDIT_BATCH_NOT_PREPARED");
    }
    const all = await linkedTx(tx, batch.id, input.organizationId);
    if (all.length !== batch.transferCount) throw new Error("XENDIT_LEDGER_ROWS_INCOMPLETE");
    if (all.some((x) => x.transfer.status === "reconciliation_required" || x.transfer.status === "submitting")) {
      throw new Error("XENDIT_UNKNOWN_OUTCOME_REQUIRES_RECONCILIATION");
    }
    const next = all.find((x) => x.transfer.status === "prepared");
    if (!next) return null;
    const [claimed] = await tx.update(payoutTransfers)
      .set({ status: "submitting", updatedAt: new Date() })
      .where(and(eq(payoutTransfers.id, next.transfer.id),
        eq(payoutTransfers.organizationId, input.organizationId),
        eq(payoutTransfers.status, "prepared"))).returning({ id: payoutTransfers.id });
    if (!claimed) throw new Error("XENDIT_TRANSFER_ALREADY_CLAIMED");
    const [linked] = await tx.update(payoutBatchTransfers)
      .set({ status: "submitting", updatedAt: new Date() })
      .where(and(eq(payoutBatchTransfers.id, next.link.id),
        eq(payoutBatchTransfers.status, "prepared"))).returning({ id: payoutBatchTransfers.id });
    if (!linked) throw new Error("XENDIT_LINK_ALREADY_CLAIMED");
    await tx.update(payoutBatches).set({
      status: "submitting", claimedAt: batch.claimedAt ?? new Date(), updatedAt: new Date(),
    }).where(eq(payoutBatches.id, batch.id));
    await tx.insert(auditEvents).values({
      organizationId: input.organizationId,
      actor: "System", action: "Xendit payout transfer claimed (provider not yet acknowledged)",
      resource: `payroll-run-${input.payrollRunId}`,
      metadata: { runId: input.payrollRunId, transferId: next.transfer.id,
        referenceNumber: next.transfer.referenceNumber, amountCents: next.transfer.amountCents,
        moneyMovedByLinaw: null },
    });
    return { ...toRow(next), status: "submitting" };
  });
}

export async function markXenditPayoutUnknown(input: {
  organizationId: number; payrollRunId: number; referenceNumber: string;
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [batch] = await tx.select().from(payoutBatches)
      .where(batchScope(input.organizationId, input.payrollRunId)).for("update");
    if (!batch || batch.provider !== "xendit") return false;
    const all = await linkedTx(tx, batch.id, input.organizationId);
    const row = all.find((r) => r.transfer.referenceNumber === input.referenceNumber);
    if (!row || row.transfer.status !== "submitting" || row.link.providerTransferId) return false;
    await tx.update(payoutTransfers).set({
      status: "reconciliation_required", updatedAt: new Date(),
    }).where(eq(payoutTransfers.id, row.transfer.id));
    await tx.update(payoutBatchTransfers).set({
      status: "reconciliation_required", updatedAt: new Date(),
    }).where(eq(payoutBatchTransfers.id, row.link.id));
    await tx.update(payoutBatches).set({
      status: "reconciliation_required", updatedAt: new Date(),
    }).where(eq(payoutBatches.id, batch.id));
    await tx.insert(auditEvents).values({
      organizationId: input.organizationId, actor: "System",
      action: "Xendit payout outcome unknown; manual provider lookup required",
      resource: `payroll-run-${input.payrollRunId}`,
      metadata: { runId: input.payrollRunId, referenceNumber: input.referenceNumber,
        amountCents: row.transfer.amountCents, settlementVerified: false },
    });
    return true;
  });
}

/**
 * Apply a provider-verified receipt/observation. This updates the original
 * ledger row, not a new transfer. Duplicate webhooks are deduplicated by the
 * shared provider-events table; terminals never regress to pending.
 */
export async function recordXenditPayoutObservation(input: {
  organizationId: number; payrollRunId: number;
  referenceNumber: string; amountCents: number;
  providerPayoutId: string; providerBusinessId: string;
  expectedBusinessId: string; providerStatus: string;
  eventId?: string; eventType?: string;
}): Promise<{ recorded: boolean; status: PayoutStatus }> {
  if (input.providerBusinessId !== input.expectedBusinessId) throw new Error("XENDIT_BUSINESS_ID_MISMATCH");
  const mapped = xenditPayoutState(input.providerStatus);
  if (mapped === "unknown") throw new Error("XENDIT_PROVIDER_STATUS_UNRECOGNIZED");
  const desired: PayoutStatus = mapped === "pending" ? "submitted" : mapped;
  return db.transaction(async (tx) => {
    const [batch] = await tx.select().from(payoutBatches)
      .where(batchScope(input.organizationId, input.payrollRunId)).for("update");
    if (!batch || batch.provider !== "xendit") throw new Error("XENDIT_BATCH_NOT_FOUND");
    const all = await linkedTx(tx, batch.id, input.organizationId);
    const match = all.find((row) => row.transfer.referenceNumber === input.referenceNumber);
    if (!match || match.transfer.amountCents !== input.amountCents) {
      throw new Error("XENDIT_TRANSFER_REFERENCE_OR_AMOUNT_MISMATCH");
    }
    if (match.link.providerTransferId && match.link.providerTransferId !== input.providerPayoutId) {
      throw new Error("XENDIT_REMOTE_PAYOUT_ID_CONFLICT");
    }
    const prior = match.transfer.status as PayoutStatus;
    if (prior === "prepared" || prior === "cancelled") throw new Error("XENDIT_UNCLAIMED_PAYOUT_OBSERVATION");
    // Deduplicate authenticated, identity-matched events before testing terminal
    // transitions: an older event replayed after a newer settlement is a no-op,
    // not a false status regression (and must not write another audit receipt).
    if (input.eventId) {
      const inserted = await tx.insert(providerEvents).values({
        provider: "xendit", eventId: input.eventId,
        organizationId: input.organizationId, payrollRunId: input.payrollRunId,
        eventType: input.eventType ?? `status.${input.providerStatus.toLowerCase()}`,
      }).onConflictDoNothing({
        target: [providerEvents.provider, providerEvents.eventId],
      }).returning({ id: providerEvents.id });
      if (inserted.length === 0) return { recorded: false, status: prior };
    }
    if (prior === "reversed" && desired !== "reversed") {
      // A NEW stale event must not be silently consumed in the inbox without
      // a matching audit receipt. Duplicate event IDs already returned above.
      throw new Error("XENDIT_REVERSED_PAYOUT_STATUS_REGRESSION_REQUIRES_INVESTIGATION");
    }
    if (prior === "succeeded" && desired !== "succeeded" && desired !== "reversed") {
      throw new Error("XENDIT_SETTLED_PAYOUT_STATUS_REGRESSION_REQUIRES_INVESTIGATION");
    }
    if (prior === "failed" && !["failed", "reversed"].includes(desired)) {
      throw new Error("XENDIT_FAILED_PAYOUT_STATUS_CHANGED_REQUIRES_INVESTIGATION");
    }
    const updateStatus: PayoutStatus =
      prior === "succeeded" && desired === "reversed" ? "reversed"
        : prior === "reconciliation_required" && desired === "submitted" ? "submitted"
        : desired;
    await tx.update(payoutBatchTransfers).set({
      providerTransferId: input.providerPayoutId,
      status: updateStatus, updatedAt: new Date(),
    }).where(eq(payoutBatchTransfers.id, match.link.id));
    await tx.update(payoutTransfers).set({
      status: updateStatus, updatedAt: new Date(),
    }).where(eq(payoutTransfers.id, match.transfer.id));

    const statuses = all.map((row) => row.transfer.id === match.transfer.id
      ? updateStatus : row.transfer.status);
    let batchStatus = batch.status;
    if (statuses.every((s) => s === "succeeded")) batchStatus = "settled";
    else if (statuses.some((s) => s === "reversed")) batchStatus = "reconciliation_required";
    else if (statuses.some((s) => s === "reconciliation_required" || s === "submitting")) batchStatus = "reconciliation_required";
    else if (statuses.every((s) => s !== "prepared")) batchStatus = "submitted";
    else batchStatus = "submitting";
    await tx.update(payoutBatches).set({
      status: batchStatus, updatedAt: new Date(),
      ...(batchStatus === "submitted" && !batch.submittedAt ? { submittedAt: new Date() } : {}),
    }).where(eq(payoutBatches.id, batch.id));
    await tx.insert(auditEvents).values({
      organizationId: input.organizationId, actor: "Xendit verified provider",
      action: updateStatus === "reversed" ? "Xendit payout reversed (investigation required)"
        : "Xendit payout transfer observed",
      resource: `payroll-run-${input.payrollRunId}`,
      metadata: {
        runId: input.payrollRunId, referenceNumber: input.referenceNumber,
        amountCents: input.amountCents, providerPayoutId: input.providerPayoutId,
        providerStatus: input.providerStatus, ledgerStatus: updateStatus,
        settlementVerified: updateStatus === "succeeded", eventId: input.eventId ?? null,
      },
    });
    return { recorded: true, status: updateStatus };
  });
}
