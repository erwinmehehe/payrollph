import type { AuditEvent } from "@/components/workspace/types";

export type PayrollPayoutTransferState = {
  batchId: string;
  transferId: string;
  referenceNumber: string;
  employeeNo: string;
  status: "pending" | "succeeded" | "failed" | "unknown";
  amountCents: number;
  providerReferenceNumber: string | null;
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
      typeof row.batchId !== "string"
      || typeof row.transferId !== "string"
      || typeof row.referenceNumber !== "string"
      || typeof row.employeeNo !== "string"
      || !status
      || !Number.isFinite(Number(row.amountCents))
    ) return [];
    return [{
      batchId: row.batchId,
      transferId: row.transferId,
      referenceNumber: row.referenceNumber,
      employeeNo: row.employeeNo,
      status,
      amountCents: Number(row.amountCents),
      providerReferenceNumber: typeof row.providerReferenceNumber === "string"
        ? row.providerReferenceNumber
        : null,
    }];
  });
}

export function derivePayrollPayoutState(events: AuditEvent[], runId: number): PayrollPayoutState {
  const relevant = events
    .filter((event) => belongsToRun(event, runId))
    .sort((a, b) => {
      const time = new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime();
      return time || b.id - a.id;
    });

  const release = relevant.find((event) => event.action === "Payroll release receipt");
  const bankFile = relevant.find((event) => {
    const meta = metadata(event);
    return event.action === "bank export generated" && meta.kind === "bank" && meta.dryRun !== true;
  });

  const completion = relevant.find((event) =>
    event.action === "Payroll payout completed manually"
    || event.action === "Payroll payout completed via PayMongo"
  );
  const providerEvent = relevant.find((event) =>
    event.action === "Payroll payout completed via PayMongo"
    || event.action === "Payroll payout reconciled via PayMongo"
    || event.action === "Payroll payout retry submitted via PayMongo"
    || event.action === "Payroll payout submitted via PayMongo"
  );
  const providerSubmission = relevant.find((event) =>
    event.action === "Payroll payout retry submitted via PayMongo"
    || event.action === "Payroll payout submitted via PayMongo"
    || event.action === "Payroll payout completed via PayMongo"
  );

  const completionMeta = completion ? metadata(completion) : {};
  const providerMeta = providerEvent ? metadata(providerEvent) : {};
  const submissionMeta = providerSubmission ? metadata(providerSubmission) : {};
  const bankMeta = bankFile ? metadata(bankFile) : {};

  const transfers = readTransfers(providerMeta.transfers);
  const total = Number.isFinite(Number(providerMeta.transferCount))
    ? Number(providerMeta.transferCount)
    : transfers.length;
  const succeeded = Number.isFinite(Number(providerMeta.succeeded))
    ? Number(providerMeta.succeeded)
    : transfers.filter((transfer) => transfer.status === "succeeded").length;
  const pending = Number.isFinite(Number(providerMeta.pending))
    ? Number(providerMeta.pending)
    : transfers.filter((transfer) => transfer.status === "pending").length;
  const failed = Number.isFinite(Number(providerMeta.failed))
    ? Number(providerMeta.failed)
    : transfers.filter((transfer) => transfer.status === "failed").length;
  const unknown = Number.isFinite(Number(providerMeta.unknown))
    ? Number(providerMeta.unknown)
    : transfers.filter((transfer) => transfer.status === "unknown").length;

  const submissionBatchId = typeof submissionMeta.batchId === "string" ? submissionMeta.batchId : null;
  const batchIds = readStringArray(providerMeta.batchIds);
  if (submissionBatchId && !batchIds.includes(submissionBatchId)) batchIds.push(submissionBatchId);

  const reconciliationStatus: PayrollPayoutState["reconciliation"]["status"] =
    !providerEvent
      ? "not-applicable"
      : completion?.action === "Payroll payout completed via PayMongo" || (total > 0 && succeeded === total)
        ? "settled"
        : failed > 0 || unknown > 0
          ? "attention"
          : pending > 0
            ? "pending"
            : "awaiting-check";

  const providerLabel =
    reconciliationStatus === "settled"
      ? `All ${total || transfers.length} PayMongo transfer(s) settled`
      : reconciliationStatus === "attention"
        ? failed > 0
          ? `${failed} PayMongo transfer(s) failed and need attention`
          : "PayMongo returned a transfer state Linaw does not recognize"
        : reconciliationStatus === "pending"
          ? `${pending} PayMongo transfer(s) are still pending`
          : "PayMongo batch submitted; refresh provider status to confirm settlement";

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
    payout: completion
      ? {
          status: "completed",
          label: completion.action === "Payroll payout completed manually"
            ? "Payout completion recorded from bank confirmation"
            : providerLabel,
          reference:
            typeof completionMeta.reference === "string"
              ? completionMeta.reference
              : typeof completionMeta.batchId === "string"
                ? completionMeta.batchId
                : batchIds.at(-1) ?? null,
          method:
            typeof completionMeta.method === "string"
              ? completionMeta.method
              : completion.action.includes("PayMongo")
                ? "PayMongo"
                : null,
          completedAt: typeof completionMeta.completedAt === "string"
            ? completionMeta.completedAt
            : iso(completion.createdAt),
        }
      : providerEvent
        ? {
            status: "submitted",
            label: providerLabel,
            reference: batchIds.at(-1) ?? submissionBatchId,
            method: "PayMongo",
            completedAt: null,
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
      provider: providerEvent ? "PayMongo" : null,
      status: reconciliationStatus,
      batchIds,
      total,
      succeeded,
      pending,
      failed,
      unknown,
      checkedAt:
        typeof providerMeta.checkedAt === "string"
          ? providerMeta.checkedAt
          : providerEvent
            ? iso(providerEvent.createdAt)
            : null,
      canRetryFailed: failed > 0,
      transfers,
    },
  };
}
