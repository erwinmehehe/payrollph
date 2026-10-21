import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, payoutBatches, payrollRuns } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { assertOrganizationUnitAccess } from "@/lib/access";
import {
  buildPayrollRetryIdempotencyKey,
  createPaymongoPayrollRetry,
  getPaymongoBatchDisbursement,
  loadPayrollPayoutRows,
} from "@/lib/paymongo-disbursements";
import {
  normalizePaymongoTransferStatus,
  reconcilePaymongoPayrollTransfers,
  type PaymongoBatchSnapshot,
  type PaymongoPayrollReconciliation,
} from "@/lib/payroll-payout-reconciliation";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";
import { derivePayrollPayoutState } from "@/lib/payroll-payout-state";
import { withPayrollPayoutSubmissionLock } from "@/lib/payout-submission-lock";
import { withPayrollRunPayoutLock } from "@/lib/payroll-run-payout-lock";
import {
  hasUnacknowledgedPaymongoRetry, PAYMONGO_RETRY_INTENT_ACTION,
  PAYMONGO_RETRY_SUBMITTED_ACTION, wasPaymongoRetryKeyAttempted,
} from "@/lib/payroll-payout-retry-evidence";
import { authorizeTreasuryOperation, type TreasuryEvidence } from "@/lib/treasury-controls";
import { latestApprovedPayoutDestinationChangeForRun } from "@/lib/payout-destination-controls";

export const dynamic = "force-dynamic";

type AuditRow = typeof auditEvents.$inferSelect;

function metadata(event: AuditRow) {
  return event.metadata && typeof event.metadata === "object"
    ? event.metadata as Record<string, unknown>
    : {};
}

function belongsToRun(event: AuditRow, runId: number) {
  return Number(metadata(event).runId) === runId;
}

function payoutBatchIds(events: AuditRow[]) {
  const ids: string[] = [];
  const seen = new Set<string>();
  const sourceActions = new Set([
    "Payroll payout submitted via PayMongo",
    "Payroll payout completed via PayMongo",
    "Payroll payout retry submitted via PayMongo",
  ]);

  for (const event of events) {
    if (!sourceActions.has(event.action)) continue;
    const batchId = metadata(event).batchId;
    if (typeof batchId !== "string" || seen.has(batchId)) continue;
    seen.add(batchId);
    ids.push(batchId);
  }
  return ids;
}

async function reconcileProvider(runId: number, events: AuditRow[]): Promise<PaymongoPayrollReconciliation> {
  const batchIds = payoutBatchIds(events);
  if (batchIds.length === 0) {
    throw new Error("No PayMongo payout batch is recorded for this payroll run.");
  }

  const [providerBatches, expectedRows] = await Promise.all([
    Promise.all(batchIds.map((batchId) => getPaymongoBatchDisbursement(batchId))),
    loadPayrollPayoutRows(runId),
  ]);

  const batches: PaymongoBatchSnapshot[] = providerBatches.map((batch) => ({
    batchId: batch.batchId,
    provider: batch.provider,
    transfers: batch.transfers.map((transfer) => ({
      batchId: batch.batchId,
      transferId: transfer.id,
      referenceNumber: transfer.referenceNumber,
      status: normalizePaymongoTransferStatus(transfer.status),
      amountCents: transfer.amountCents,
      providerReferenceNumber: transfer.providerReferenceNumber,
      providerError: transfer.providerError,
      providerErrorCode: transfer.providerErrorCode,
    })),
  }));

  return reconcilePaymongoPayrollTransfers({ runId, expectedRows, batches });
}

async function writeReconciliation(input: {
  organizationId: number;
  actor: string;
  periodLabel: string;
  runId: number;
  reconciliation: PaymongoPayrollReconciliation;
  treasury: TreasuryEvidence | null;
}) {
  const checkedAt = new Date().toISOString();
  const action = input.reconciliation.completed
    ? "Payroll payout completed via PayMongo"
    : "Payroll payout reconciled via PayMongo";

  await recordAuditEvent({
    organizationId: input.organizationId,
    actor: input.actor,
    action,
    resource: input.periodLabel,
    metadata: {
      runId: input.runId,
      batchIds: input.reconciliation.batchIds,
      transfers: input.reconciliation.transfers,
      succeeded: input.reconciliation.succeeded,
      pending: input.reconciliation.pending,
      failed: input.reconciliation.failed,
      unknown: input.reconciliation.unknown,
      transferCount: input.reconciliation.total,
      checkedAt,
      completedAt: input.reconciliation.completed ? checkedAt : null,
      moneyMovedByLinaw: true,
      settlementVerified: input.reconciliation.completed,
      treasury: input.treasury,
    },
  });

  return checkedAt;
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isInteger(runId)) {
    return Response.json({ error: "Invalid payroll run id." }, { status: 400 });
  }

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!run) return Response.json({ error: "Payroll run not found." }, { status: 404 });

  const treasury = await authorizeTreasuryOperation({
    organizationId: run.organizationId,
    runId: run.id,
    userId: user.id,
    userName: user.name,
    requireReleaseSeparation: false,
  });
  if (treasury.response) return treasury.response;

  const scopeDenied = await assertOrganizationUnitAccess(
    user.id,
    run.organizationId,
    run.scopeOrgUnitId,
    "This payroll run is outside your assigned organization unit.",
  );
  if (scopeDenied) return scopeDenied;

  const events = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.organizationId, run.organizationId))
    .orderBy(desc(auditEvents.id));
  const state = derivePayrollPayoutState(events, run.id);
  const { searchParams } = new URL(request.url);
  // Existing provider-specific GET and CSV behavior remains unchanged. The
  // additive payout view certifies a non-provider payout without inventing zeros.
  if (state.reconciliation.provider !== "PayMongo" && searchParams.get("view") !== "payout") {
    return Response.json({ error: "No PayMongo payout reconciliation exists for this payroll run." }, { status: 409 });
  }
  if (searchParams.get("format") !== "csv") {
    return Response.json({ organizationId: run.organizationId, runId: run.id,
      runNetPay: run.netPay, runEmployeeCount: run.employeeCount,
      periodLabel: run.periodLabel, ...state });
  }

  const rows = [
    ["employee_no", "reference_number", "amount_php", "status", "batch_id", "transfer_id", "provider_reference", "provider_error_code", "provider_error", "occurred_at"],
    ...state.reconciliation.transfers.map((transfer) => [
      transfer.employeeNo,
      transfer.referenceNumber,
      (transfer.amountCents / 100).toFixed(2),
      transfer.status,
      transfer.batchId ?? "",
      transfer.transferId,
      transfer.providerReferenceNumber ?? "",
      transfer.providerErrorCode ?? "",
      transfer.providerError ?? "",
      transfer.occurredAt ?? "",
    ]),
  ];
  const body = rows.map((row) => row.map(csvCell).join(",")).join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="payroll-${run.id}-payout-reconciliation.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const { id } = await params;
  const runId = Number(id);
  if (!Number.isInteger(runId)) {
    return Response.json({ error: "Invalid payroll run id." }, { status: 400 });
  }

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const demoDenied = publicDemoMutationDenied(user.email, "Payroll payout reconciliation");
  if (demoDenied) return demoDenied;

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!run) return Response.json({ error: "Payroll run not found." }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const action = body.action === "retry-failed" ? "retry-failed" : "reconcile";
  const treasury = await authorizeTreasuryOperation({
    organizationId: run.organizationId,
    runId: run.id,
    userId: user.id,
    userName: user.name,
    requireReleaseSeparation: action === "retry-failed",
  });
  if (treasury.response) return treasury.response;

  const scopeDenied = await assertOrganizationUnitAccess(
    user.id,
    run.organizationId,
    run.scopeOrgUnitId,
    "This payroll run is outside your assigned organization unit.",
  );
  if (scopeDenied) return scopeDenied;

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "payout-reconciliation",
    resourceId: runId,
    limit: 10,
    windowMs: 10 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (run.status !== "Released") {
    return Response.json(
      { error: "Payout reconciliation is available only after payroll release." },
      { status: 409 },
    );
  }
  if (!process.env.PAYMONGO_SECRET_KEY) {
    return Response.json(
      { error: "PayMongo credentials are not configured.", readiness: "/api/readiness" },
      { status: 501 },
    );
  }

  const allEvents = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.organizationId, run.organizationId))
    .orderBy(asc(auditEvents.createdAt), asc(auditEvents.id));
  const events = allEvents.filter((event) => belongsToRun(event, run.id));

  let reconciliation: PaymongoPayrollReconciliation;
  try {
    reconciliation = await reconcileProvider(run.id, events);
  } catch (error) {
    const message = error instanceof Error ? error.message : "PayMongo reconciliation failed.";
    await recordAuditEvent({
      organizationId: run.organizationId,
      actor: user.name,
      action: "Payroll payout reconciliation failed",
      resource: run.periodLabel,
      metadata: { runId: run.id, error: message, moneyMovedByLinaw: false },
    });
    return Response.json({ error: message }, { status: 502 });
  }

  const checkedAt = await writeReconciliation({
    organizationId: run.organizationId,
    actor: user.name,
    periodLabel: run.periodLabel,
    runId: run.id,
    reconciliation,
    treasury: treasury.evidence,
  });

  if (action === "reconcile") {
    return Response.json({ organizationId: run.organizationId, runId: run.id, reconciliation, checkedAt });
  }

  if (body.confirm !== true) {
    return Response.json(
      { error: "Confirm the failed-only retry before creating a new payout batch." },
      { status: 400 },
    );
  }
  if (reconciliation.failed === 0) {
    return Response.json(
      {
        error: reconciliation.pending > 0
          ? "There are no failed transfers to retry. Pending transfers must not be resent."
          : "There are no failed transfers to retry.",
        reconciliation,
      },
      { status: 409 },
    );
  }
  if (process.env.PAYMONGO_DISBURSEMENTS_ENABLED !== "true") {
    return Response.json(
      { error: "Live PayMongo disbursement is not enabled.", readiness: "/api/readiness" },
      { status: 501 },
    );
  }

  const payoutEvents = await db.select().from(auditEvents)
    .where(eq(auditEvents.organizationId, run.organizationId));
  const latestPreflight = payoutEvents
    .filter((event) => {
      if (event.action !== "PayMongo payroll preflight passed") return false;
      if (!event.metadata || typeof event.metadata !== "object") return false;
      return Number((event.metadata as Record<string, unknown>).runId) === run.id;
    })
    .sort((a, b) => b.id - a.id)[0];

  if (!latestPreflight) {
    return Response.json({
      error: "Run the no-money PayMongo preflight successfully before retrying failed transfers.",
    }, { status: 409 });
  }

  const changedAfterPreflight = await latestApprovedPayoutDestinationChangeForRun({
    organizationId: run.organizationId,
    runId: run.id,
    after: latestPreflight.createdAt,
  });
  if (changedAfterPreflight) {
    return Response.json({
      error: "An employee payout destination changed after the last PayMongo preflight. Run preflight again before retrying failed transfers.",
      payoutDestinationChangeRequestId: changedAfterPreflight.id,
      employeeId: changedAfterPreflight.employeeId,
    }, { status: 409 });
  }

  // No provider acknowledgement means UNKNOWN, never permission to resend.
  let retryIntentRecorded = false;
  let attemptedKey: string | null = null;
  let attemptedReferences = reconciliation.retryableReferences;
  let attemptedBatchIds = reconciliation.batchIds;

  try {
    const result = await withPayrollRunPayoutLock(run.organizationId, run.id, async () => {
      // This lock is shared with first payout submission, Xendit staging
      // and final bank-file issuance. Recheck durable evidence INSIDE it.
      const runEvents = (await db.select().from(auditEvents)
        .where(eq(auditEvents.organizationId, run.organizationId))
        .orderBy(asc(auditEvents.createdAt), asc(auditEvents.id)))
        .filter((event) => belongsToRun(event, run.id));

      if (hasUnacknowledgedPaymongoRetry(runEvents)) {
        throw new Error("PAYROLL_PAYMONGO_RETRY_OUTCOME_UNVERIFIED: A previous retry may have moved salaries. Reconcile the provider outcome manually before resubmitting.");
      }
      if (runEvents.some((event) =>
        event.action === "Payroll payout completed manually"
        || (event.action === "bank export generated"
          && metadata(event).kind === "bank" && metadata(event).dryRun !== true)
      )) {
        throw new Error("PAYROLL_PREVIOUS_FINAL_BANK_FILE_OR_MANUAL_PAYMENT: Reconcile earlier bank payment evidence before retrying PayMongo.");
      }
      const [existingLedger] = await db.select({ provider: payoutBatches.provider })
        .from(payoutBatches).where(and(
          eq(payoutBatches.organizationId, run.organizationId),
          eq(payoutBatches.payrollRunId, run.id),
        )).limit(1);
      if (existingLedger) {
        throw new Error("PAYROLL_PAYOUT_LEDGER_ALREADY_CLAIMED: Reconcile the existing payment ledger before retrying PayMongo.");
      }

      // An overlapping request may already have retried the same employees.
      // Refresh provider status under the lock, not from the stale pre-lock read.
      const fresh = await reconcileProvider(run.id, runEvents);
      if (fresh.failed === 0 || fresh.retryableReferences.length === 0) {
        throw new Error("PAYROLL_PAYMONGO_RETRY_NO_FAILED_TRANSFERS: No provider-confirmed failed transfer remains eligible for retry.");
      }
      const retryKey = buildPayrollRetryIdempotencyKey(
        run.id, fresh.batchIds, fresh.retryableReferences,
      );
      if (wasPaymongoRetryKeyAttempted(runEvents, retryKey)) {
        throw new Error("PAYROLL_PAYMONGO_RETRY_ALREADY_ATTEMPTED: This retry key was already used. Reconcile its provider outcome before trying again.");
      }

      attemptedKey = retryKey;
      attemptedReferences = fresh.retryableReferences;
      attemptedBatchIds = fresh.batchIds;
      const retry = await withPayrollPayoutSubmissionLock(
        () => createPaymongoPayrollRetry({
          runId: run.id,
          referenceNumbers: fresh.retryableReferences,
          sourceBatchIds: fresh.batchIds,
          beforeProviderPost: async () => {
            // This must commit after local recipient/bank/wallet validation
            // and before any money-moving HTTP request.
            await recordAuditEvent({
              organizationId: run.organizationId,
              actor: user.name,
              action: PAYMONGO_RETRY_INTENT_ACTION,
              resource: run.periodLabel,
              metadata: {
                runId: run.id, provider: "PayMongo", idempotencyKey: retryKey,
                retryOfBatchIds: fresh.batchIds,
                retryReferences: fresh.retryableReferences,
                providerOutcomeVerified: false,
                moneyMovedByLinaw: null,
                treasury: treasury.evidence,
              },
            });
            retryIntentRecorded = true;
          },
        }),
      );

      await recordAuditEvent({
        organizationId: run.organizationId,
        actor: user.name,
        action: PAYMONGO_RETRY_SUBMITTED_ACTION,
        resource: run.periodLabel,
        metadata: {
          runId: run.id,
          batchId: retry.batchId,
          idempotencyKey: retryKey,
          provider: retry.provider,
          retryOfBatchIds: fresh.batchIds,
          retryReferences: fresh.retryableReferences,
          transferCount: retry.transfers.length,
          transfers: retry.transfers,
          moneyMovedByLinaw: true,
          treasury: treasury.evidence,
        },
      });
      return { retry, fresh };
    });

    return Response.json({
      organizationId: run.organizationId,
      runId: run.id,
      retried: true,
      failedOnly: true,
      retry: result.retry,
      reconciliation: result.fresh,
      message: result.retry.transfers.length
        + " failed transfer(s) were resubmitted. Pending and succeeded transfers were not resent.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed-transfer retry could not be submitted.";
    await recordAuditEvent({
      organizationId: run.organizationId,
      actor: user.name,
      action: retryIntentRecorded ? "Payroll payout retry outcome unknown" : "Payroll payout retry failed",
      resource: run.periodLabel,
      metadata: {
        runId: run.id,
        sourceBatchIds: attemptedBatchIds,
        retryReferences: attemptedReferences,
        idempotencyKey: attemptedKey,
        error: message,
        providerOutcomeUnknown: retryIntentRecorded,
        moneyMovedByLinaw: retryIntentRecorded ? null : false,
        treasury: treasury.evidence,
      },
    });
    const conflict = !retryIntentRecorded && (
      message.startsWith("PAYROLL_") || message.startsWith("PAYOUT_")
      || message.startsWith("Another payroll payout is already being submitted")
    );
    return Response.json({
      error: message, reconciliation,
      code: conflict ? "PAYROLL_PAYOUT_CLAIM_CONFLICT" : undefined,
    }, { status: conflict ? 409 : 502 });
  }
}
