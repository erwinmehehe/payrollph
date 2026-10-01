import type { AuditEvent } from "@/components/workspace/types";

export type PayrollPayoutTransferState = {
  batchId: string | null;
  transferId: string;
  referenceNumber: string;
  employeeNo: string;
  status: "pending" | "succeeded" | "failed" | "unknown";
  amountCents: number;
  providerReferenceNumber: string | null;
  providerError: string | null;
  providerErrorCode: string | null;
  occurredAt: string | null;
};

export type PayrollPayoutState = {
  release: {
    done: boolean;
    at: string | null;
  };
  bankFile: {
    status: "waiting" | "generated";
    filename: string | null;
    template: string | null;
    generatedAt: string | null;
  };
  payout: {
    status: "waiting-for-file" | "ready" | "submitted" | "completed";
    label: string;
    reference: string | null;
    method: string | null;
    completedAt: string | null;
  };
  reconciliation: {
    provider: "PayMongo" | null;
    status: "not-applicable" | "awaiting-check" | "pending" | "attention" | "settled";
    batchIds: string[];
    total: number;
    succeeded: number;
    pending: number;
    failed: number;
    unknown: number;
    checkedAt: string | null;
    canRetryFailed: boolean;
    settlementRegressed: boolean;
    transfers: PayrollPayoutTransferState[];
  };
};

function metadata(event: AuditEvent) {
  return event.metadata && typeof event.metadata === "object"
    ? event.metadata as Record<string, unknown>
    : {};
}

function belongsToRun(event: AuditEvent, runId: number) {
  return Number(metadata(event).runId) === runId;
}

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readTransfers(value: unknown): PayrollPayoutTransferState[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    const status =
      row.status === "pending" || row.status === "succeeded" || row.status === "failed" || row.status === "unknown"
        ? row.status
        : null;
    if (
      typeof row.transferId !== "string"
      || typeof row.referenceNumber !== "string"
      || typeof row.employeeNo !== "string"
      || !status
      || !Number.isFinite(Number(row.amountCents))
    ) return [];
    return [{
      batchId: typeof row.batchId === "string" ? row.batchId : null,
      transferId: row.transferId,
      referenceNumber: row.referenceNumber,
      employeeNo: row.employeeNo,
      status,
      amountCents: Number(row.amountCents),
      providerReferenceNumber: typeof row.providerReferenceNumber === "string"
        ? row.providerReferenceNumber
        : null,
      providerError: typeof row.providerError === "string" ? row.providerError : null,
      providerErrorCode: typeof row.providerErrorCode === "string" ? row.providerErrorCode : null,
      occurredAt: typeof row.occurredAt === "string" ? row.occurredAt : null,
    }];
  });
}

function eventTime(event: AuditEvent) {
  const meta = metadata(event);
  const occurredAt = typeof meta.occurredAt === "string" ? meta.occurredAt : null;
  return new Date(occurredAt ?? String(event.createdAt)).getTime();
}

export function derivePayrollPayoutState(events: AuditEvent[], runId: number): PayrollPayoutState {
  const relevant = events
    .filter((event) => belongsToRun(event, runId))
    .sort((a, b) => {
      const time = eventTime(b) - eventTime(a);
      return time || b.id - a.id;
    });

  const release = relevant.find((event) => event.action === "Payroll release receipt");
  const bankFile = relevant.find((event) => {
    const meta = metadata(event);
    return event.action === "bank export generated" && meta.kind === "bank" && meta.dryRun !== true;
  });

  const manualCompletion = relevant.find((event) => event.action === "Payroll payout completed manually");
  const providerCompletion = relevant.find((event) => event.action === "Payroll payout completed via PayMongo");
  const providerSnapshot = relevant.find((event) =>
    event.action === "Payroll payout completed via PayMongo"
    || event.action === "Payroll payout reconciled via PayMongo"
  );
  const providerSubmissions = relevant.filter((event) =>
    event.action === "Payroll payout submitted via PayMongo"
    || event.action === "Payroll payout retry submitted via PayMongo"
    || event.action === "Payroll payout completed via PayMongo"
  );
  const webhookEvents = relevant
    .filter((event) => event.action === "PayMongo transfer webhook received")
    .sort((a, b) => eventTime(a) - eventTime(b));

  const providerStarted = providerSubmissions.length > 0 || Boolean(providerSnapshot) || webhookEvents.length > 0;
  const bankMeta = bankFile ? metadata(bankFile) : {};
  const snapshotMeta = providerSnapshot ? metadata(providerSnapshot) : {};

  const transferMap = new Map<string, PayrollPayoutTransferState>();
  for (const transfer of readTransfers(snapshotMeta.transfers)) {
    transferMap.set(transfer.referenceNumber, transfer);
  }

  for (const webhook of webhookEvents) {
    const meta = metadata(webhook);
    const status = meta.status === "succeeded" || meta.status === "failed" ? meta.status : null;
    if (
      typeof meta.transferId !== "string"
      || typeof meta.referenceNumber !== "string"
      || typeof meta.employeeNo !== "string"
      || !status
      || !Number.isFinite(Number(meta.amountCents))
    ) continue;
    const previous = transferMap.get(meta.referenceNumber);
    transferMap.set(meta.referenceNumber, {
      batchId: typeof meta.batchId === "string" ? meta.batchId : previous?.batchId ?? null,
      transferId: meta.transferId,
      referenceNumber: meta.referenceNumber,
      employeeNo: meta.employeeNo,
      status,
      amountCents: Number(meta.amountCents),
      providerReferenceNumber: typeof meta.providerReferenceNumber === "string"
        ? meta.providerReferenceNumber
        : previous?.providerReferenceNumber ?? null,
      providerError: typeof meta.providerError === "string" ? meta.providerError : null,
      providerErrorCode: typeof meta.providerErrorCode === "string" ? meta.providerErrorCode : null,
      occurredAt: typeof meta.occurredAt === "string" ? meta.occurredAt : iso(webhook.createdAt),
    });
  }

  const transfers = [...transferMap.values()];
  const knownTotals = providerSubmissions
    .map((event) => Number(metadata(event).transferCount))
    .filter((value) => Number.isFinite(value) && value > 0);
  const snapshotTotal = Number(snapshotMeta.transferCount);
  if (Number.isFinite(snapshotTotal) && snapshotTotal > 0) knownTotals.push(snapshotTotal);
  const total = knownTotals.length > 0 ? Math.max(...knownTotals) : transfers.length;

  const succeeded = transfers.filter((transfer) => transfer.status === "succeeded").length;
  const failed = transfers.filter((transfer) => transfer.status === "failed").length;
  const unknown = transfers.filter((transfer) => transfer.status === "unknown").length;
  const explicitPending = transfers.filter((transfer) => transfer.status === "pending").length;
  const unreported = Math.max(0, total - succeeded - failed - unknown - explicitPending);
  const pending = explicitPending + unreported;

  const batchIds: string[] = [];
  const seenBatchIds = new Set<string>();
  for (const event of [...providerSubmissions].reverse()) {
    const batchId = metadata(event).batchId;
    if (typeof batchId === "string" && !seenBatchIds.has(batchId)) {
      seenBatchIds.add(batchId);
      batchIds.push(batchId);
    }
  }
  for (const batchId of readStringArray(snapshotMeta.batchIds)) {
    if (!seenBatchIds.has(batchId)) {
      seenBatchIds.add(batchId);
      batchIds.push(batchId);
    }
  }

  const latestProviderLifecycle = relevant.find((event) =>
    event.action === "Payroll payout completed via PayMongo"
    || event.action === "Payroll payout reconciled via PayMongo"
    || event.action === "Payroll payout retry submitted via PayMongo"
    || event.action === "Payroll payout submitted via PayMongo"
    || event.action === "PayMongo transfer webhook received"
  );
  const latestMeta = latestProviderLifecycle ? metadata(latestProviderLifecycle) : {};
  const settlementRegressed = Boolean(
    providerCompletion
    && latestProviderLifecycle?.action === "PayMongo transfer webhook received"
    && latestMeta.status === "failed"
    && eventTime(latestProviderLifecycle) > eventTime(providerCompletion)
  );

  const reconciliationStatus: PayrollPayoutState["reconciliation"]["status"] =
    !providerStarted
      ? "not-applicable"
      : total > 0 && succeeded === total && failed === 0 && unknown === 0
        ? "settled"
        : failed > 0 || unknown > 0
          ? "attention"
          : pending > 0
            ? "pending"
            : "awaiting-check";

  const providerLabel =
    settlementRegressed
      ? `Settlement changed after completion; ${failed} transfer(s) now report failed. Review as a returned or reversed payout before retrying.`
      : reconciliationStatus === "settled"
        ? `All ${total || transfers.length} PayMongo transfer(s) settled`
        : reconciliationStatus === "attention"
          ? failed > 0
            ? `${failed} PayMongo transfer(s) failed and need attention`
            : "PayMongo returned a transfer state Linaw does not recognize"
          : reconciliationStatus === "pending"
            ? `${pending} PayMongo transfer(s) are still pending`
            : "PayMongo batch submitted; refresh provider status to confirm settlement";

  const latestProviderReference =
    typeof latestMeta.batchId === "string"
      ? latestMeta.batchId
      : batchIds.at(-1) ?? null;
  const latestCheckedAt =
    typeof latestMeta.checkedAt === "string"
      ? latestMeta.checkedAt
      : typeof latestMeta.occurredAt === "string"
        ? latestMeta.occurredAt
        : latestProviderLifecycle
          ? iso(latestProviderLifecycle.createdAt)
          : null;

  return {
    release: {
      done: Boolean(release),
      at: release ? iso(release.createdAt) : null,
    },
    bankFile: {
      status: bankFile ? "generated" : "waiting",
      filename: typeof bankMeta.filename === "string" ? bankMeta.filename : null,
      template: typeof bankMeta.template === "string" ? bankMeta.template : null,
      generatedAt: bankFile ? iso(bankFile.createdAt) : null,
    },
    payout: manualCompletion
      ? {
          status: "completed",
          label: "Payout completion recorded from bank confirmation",
          reference: typeof metadata(manualCompletion).reference === "string"
            ? metadata(manualCompletion).reference as string
            : null,
          method: typeof metadata(manualCompletion).method === "string"
            ? metadata(manualCompletion).method as string
            : null,
          completedAt: typeof metadata(manualCompletion).completedAt === "string"
            ? metadata(manualCompletion).completedAt as string
            : iso(manualCompletion.createdAt),
        }
      : providerStarted
        ? {
            status: reconciliationStatus === "settled" ? "completed" : "submitted",
            label: providerLabel,
            reference: latestProviderReference,
            method: "PayMongo",
            completedAt: reconciliationStatus === "settled"
              ? providerCompletion
                ? typeof metadata(providerCompletion).completedAt === "string"
                  ? metadata(providerCompletion).completedAt as string
                  : iso(providerCompletion.createdAt)
                : latestCheckedAt
              : null,
          }
        : bankFile
          ? {
              status: "ready",
              label: "Bank file generated; record the bank confirmation after payout",
              reference: null,
              method: null,
              completedAt: null,
            }
          : {
              status: "waiting-for-file",
              label: "Generate the final bank file before recording payout completion",
              reference: null,
              method: null,
              completedAt: null,
            },
    reconciliation: {
      provider: providerStarted ? "PayMongo" : null,
      status: reconciliationStatus,
      batchIds,
      total,
      succeeded,
      pending,
      failed,
      unknown,
      checkedAt: latestCheckedAt,
      canRetryFailed: failed > 0,
      settlementRegressed,
      transfers,
    },
  };
}
