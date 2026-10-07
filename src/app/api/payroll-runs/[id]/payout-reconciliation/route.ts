import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, payrollRuns } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { assertOrganizationUnitAccess } from "@/lib/access";
import {
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
  if (state.reconciliation.provider !== "PayMongo") {
    return Response.json({ error: "No PayMongo payout reconciliation exists for this payroll run." }, { status: 409 });
  }

  const { searchParams } = new URL(request.url);
  if (searchParams.get("format") !== "csv") {
    return Response.json({ runId: run.id, periodLabel: run.periodLabel, payout: state.payout, reconciliation: state.reconciliation });
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
    return Response.json({ reconciliation, checkedAt });
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

  try {
    const retry = await withPayrollPayoutSubmissionLock(
      () => createPaymongoPayrollRetry({
        runId: run.id,
        referenceNumbers: reconciliation.retryableReferences,
        sourceBatchIds: reconciliation.batchIds,
      }),
    );

    await recordAuditEvent({
      organizationId: run.organizationId,
      actor: user.name,
      action: "Payroll payout retry submitted via PayMongo",
      resource: run.periodLabel,
      metadata: {
        runId: run.id,
        batchId: retry.batchId,
        provider: retry.provider,
        retryOfBatchIds: reconciliation.batchIds,
        retryReferences: reconciliation.retryableReferences,
        transferCount: retry.transfers.length,
        transfers: retry.transfers,
        moneyMovedByLinaw: true,
        treasury: treasury.evidence,
      },
    });

    return Response.json({
      retried: true,
      failedOnly: true,
      retry,
      reconciliation,
      message: `${retry.transfers.length} failed transfer(s) were resubmitted. Pending and succeeded transfers were not resent.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed-transfer retry could not be submitted.";
    await recordAuditEvent({
      organizationId: run.organizationId,
      actor: user.name,
      action: "Payroll payout retry failed",
      resource: run.periodLabel,
      metadata: {
        runId: run.id,
        sourceBatchIds: reconciliation.batchIds,
        retryReferences: reconciliation.retryableReferences,
        error: message,
        moneyMovedByLinaw: false,
        treasury: treasury.evidence,
      },
    });
    return Response.json({ error: message, reconciliation }, { status: 502 });
  }
}
