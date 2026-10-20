import type { PayrollPayoutRow } from "@/lib/paymongo-disbursements";

export type PaymongoTransferStatus = "pending" | "succeeded" | "failed" | "unknown";

export type PaymongoTransferSnapshot = {
  batchId: string;
  transferId: string;
  referenceNumber: string;
  status: PaymongoTransferStatus;
  amountCents: number;
  providerReferenceNumber: string | null;
  providerError?: string | null;
  providerErrorCode?: string | null;
};

export type PaymongoBatchSnapshot = {
  batchId: string;
  provider: "instapay" | "pesonet";
  transfers: PaymongoTransferSnapshot[];
};

export type PaymongoPayrollReconciliation = {
  batchIds: string[];
  transfers: Array<PaymongoTransferSnapshot & { employeeNo: string }>;
  succeeded: number;
  pending: number;
  failed: number;
  unknown: number;
  total: number;
  completed: boolean;
  retryableReferences: string[];
};

export function normalizePaymongoTransferStatus(value: string): PaymongoTransferStatus {
  const normalized = value.trim().toLowerCase();
  if (normalized === "pending" || normalized === "succeeded" || normalized === "failed") return normalized;
  return "unknown";
}

export function payrollEmployeeNoFromReference(runId: number, referenceNumber: string) {
  const prefix = `PAY-${runId}-`;
  return referenceNumber.startsWith(prefix) ? referenceNumber.slice(prefix.length) : null;
}

/**
 * Reconciles the provider's latest state per canonical payroll reference.
 *
 * Batches must be supplied oldest -> newest. A later retry batch is allowed to
 * replace the state for only the references it retried. Pending or succeeded
 * transfers in earlier batches remain untouched.
 */
export function reconcilePaymongoPayrollTransfers(input: {
  runId: number;
  expectedRows: PayrollPayoutRow[];
  batches: PaymongoBatchSnapshot[];
}): PaymongoPayrollReconciliation {
  if (!Number.isSafeInteger(input.runId) || input.runId <= 0 ||
      !Array.isArray(input.expectedRows) || input.expectedRows.length === 0 ||
      input.expectedRows.length > 1000 || !Array.isArray(input.batches)) {
    throw new Error("PAYOUT_RECONCILIATION_INVALID_INPUT");
  }
  const expected = new Map<string, PayrollPayoutRow>();
  const employeeNos = new Set<string>();
  for (const row of input.expectedRows) {
    if (!row || typeof row.referenceNumber !== "string" ||
        typeof row.employeeNo !== "string" ||
        payrollEmployeeNoFromReference(input.runId, row.referenceNumber) !== row.employeeNo ||
        !Number.isSafeInteger(row.amountCents) || row.amountCents <= 0 ||
        expected.has(row.referenceNumber) || employeeNos.has(row.employeeNo)) {
      throw new Error("PAYOUT_RECONCILIATION_DUPLICATE_OR_INVALID_RELEASED_ROW");
    }
    expected.set(row.referenceNumber, row);
    employeeNos.add(row.employeeNo);
  }

  const latest = new Map<string, PaymongoTransferSnapshot>();
  const batchIds = new Set<string>();
  const transferIds = new Set<string>();
  for (const batch of input.batches) {
    if (!batch || typeof batch.batchId !== "string" || !batch.batchId.trim() ||
        !["instapay", "pesonet"].includes(batch.provider) ||
        !Array.isArray(batch.transfers) || batchIds.has(batch.batchId)) {
      throw new Error("PAYOUT_RECONCILIATION_DUPLICATE_OR_INVALID_BATCH");
    }
    batchIds.add(batch.batchId);
    const referencesInBatch = new Set<string>();
    for (const transfer of batch.transfers) {
      if (!transfer || transfer.batchId !== batch.batchId ||
          typeof transfer.transferId !== "string" || !transfer.transferId.trim() ||
          transferIds.has(transfer.transferId) ||
          referencesInBatch.has(transfer.referenceNumber) ||
          !["pending", "succeeded", "failed", "unknown"].includes(transfer.status)) {
        throw new Error("PAYOUT_RECONCILIATION_DUPLICATE_OR_INVALID_TRANSFER");
      }
      transferIds.add(transfer.transferId);
      referencesInBatch.add(transfer.referenceNumber);
      const expectedRow = expected.get(transfer.referenceNumber);
      if (!expectedRow) {
        throw new Error(
          `PayMongo batch ${batch.batchId} returned transfer reference "${transfer.referenceNumber}" that does not belong to payroll run #${input.runId}.`,
        );
      }
      if (!Number.isSafeInteger(transfer.amountCents) ||
          transfer.amountCents !== expectedRow.amountCents) {
        throw new Error(
          `PayMongo amount mismatch for ${transfer.referenceNumber}: provider ${transfer.amountCents} cents, released payroll ${expectedRow.amountCents} cents.`,
        );
      }
      // Retrying a succeeded/pending/unknown transfer can duplicate real funds.
      // Only a previously FAILED reference may have another provider attempt.
      const previous = latest.get(transfer.referenceNumber);
      if (previous && previous.status !== "failed") {
        throw new Error("PAYOUT_RECONCILIATION_UNSAFE_RETRY_" + previous.status.toUpperCase());
      }
      latest.set(transfer.referenceNumber, transfer);
    }
  }

  const missing = input.expectedRows.filter((row) => !latest.has(row.referenceNumber));
  if (missing.length > 0) {
    throw new Error(
      `PayMongo reconciliation is missing ${missing.length} released payroll transfer(s): ${missing.map((row) => row.employeeNo).join(", ")}.`,
    );
  }

  const transfers = input.expectedRows.map((row) => {
    const transfer = latest.get(row.referenceNumber)!;
    const employeeNo = payrollEmployeeNoFromReference(input.runId, transfer.referenceNumber);
    if (!employeeNo || employeeNo !== row.employeeNo) {
      throw new Error(`PayMongo reference ${transfer.referenceNumber} does not match employee ${row.employeeNo}.`);
    }
    return { ...transfer, employeeNo };
  });

  const succeeded = transfers.filter((transfer) => transfer.status === "succeeded").length;
  const pending = transfers.filter((transfer) => transfer.status === "pending").length;
  const failed = transfers.filter((transfer) => transfer.status === "failed").length;
  const unknown = transfers.filter((transfer) => transfer.status === "unknown").length;

  return {
    batchIds: input.batches.map((batch) => batch.batchId),
    transfers,
    succeeded,
    pending,
    failed,
    unknown,
    total: transfers.length,
    completed: transfers.length > 0 && succeeded === transfers.length,
    retryableReferences: transfers
      .filter((transfer) => transfer.status === "failed")
      .map((transfer) => transfer.referenceNumber),
  };
}
