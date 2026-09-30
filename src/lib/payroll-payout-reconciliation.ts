import type { PayrollPayoutRow } from "@/lib/paymongo-disbursements";

export type PaymongoTransferStatus = "pending" | "succeeded" | "failed" | "unknown";

export type PaymongoTransferSnapshot = {
  batchId: string;
  transferId: string;
  referenceNumber: string;
  status: PaymongoTransferStatus;
  amountCents: number;
  providerReferenceNumber: string | null;
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
  const expected = new Map(input.expectedRows.map((row) => [row.referenceNumber, row]));
  const latest = new Map<string, PaymongoTransferSnapshot>();

  for (const batch of input.batches) {
    for (const transfer of batch.transfers) {
      const expectedRow = expected.get(transfer.referenceNumber);
      if (!expectedRow) {
        throw new Error(
          `PayMongo batch ${batch.batchId} returned transfer reference "${transfer.referenceNumber}" that does not belong to payroll run #${input.runId}.`,
        );
      }
      if (transfer.amountCents !== expectedRow.amountCents) {
        throw new Error(
          `PayMongo amount mismatch for ${transfer.referenceNumber}: provider ${transfer.amountCents} cents, released payroll ${expectedRow.amountCents} cents.`,
        );
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
