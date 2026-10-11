import { createHash } from "node:crypto";

/**
 * Only non-sensitive ledger identifiers are hashed here. No bank destination,
 * employee name, government ID or raw provider payload is persisted.
 */
export type PayoutIntent = Readonly<{
  employeeId: number;
  payrollEntryId: number;
  referenceNumber: string;
  amountCents: number;
}>;

export function payoutCentsFromNetPay(netPay: string): number {
  if (typeof netPay !== "string" || !/^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/.test(netPay)) {
    throw new Error("PAYOUT_INVALID_NET_AMOUNT: Expected an exact positive or zero peso amount with at most two decimals.");
  }
  const [whole, fractional = ""] = netPay.split(".");
  const cents = Number(whole) * 100 + Number(fractional.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error("PAYOUT_AMOUNT_OUT_OF_RANGE");
  return cents;
}

export function canonicalPayoutIntents(intents: readonly PayoutIntent[]): PayoutIntent[] {
  if (!Array.isArray(intents) || intents.length === 0 || intents.length > 1000) {
    throw new Error("PAYOUT_INTENTS_INVALID_COUNT");
  }
  const employees = new Set<number>();
  const entries = new Set<number>();
  const references = new Set<string>();
  const sorted = [...intents].sort((a, b) => a.employeeId - b.employeeId);
  for (const row of sorted) {
    if (!Number.isSafeInteger(row.employeeId) || row.employeeId <= 0
      || !Number.isSafeInteger(row.payrollEntryId) || row.payrollEntryId <= 0
      || !Number.isSafeInteger(row.amountCents) || row.amountCents <= 0
      || typeof row.referenceNumber !== "string" || row.referenceNumber.length > 120
      || !/^PAY-[1-9]\d*-[A-Za-z0-9_-]+$/.test(row.referenceNumber)
      || employees.has(row.employeeId) || entries.has(row.payrollEntryId)
      || references.has(row.referenceNumber)) {
      throw new Error("PAYOUT_INVALID_OR_DUPLICATED_TRANSFER");
    }
    employees.add(row.employeeId);
    entries.add(row.payrollEntryId);
    references.add(row.referenceNumber);
  }
  const total = sorted.reduce((sum, row) => sum + row.amountCents, 0);
  if (!Number.isSafeInteger(total)) throw new Error("PAYOUT_AMOUNT_OUT_OF_RANGE");
  return sorted;
}

export function payoutBatchFingerprint(intents: readonly PayoutIntent[]): string {
  const sorted = canonicalPayoutIntents(intents);
  return createHash("sha256")
    .update(JSON.stringify(sorted.map(({ employeeId, payrollEntryId, referenceNumber, amountCents }) =>
      [employeeId, payrollEntryId, referenceNumber, amountCents])))
    .digest("hex");
}

/**
 * One exact PayMongo key per initial payroll batch, NOT one key per employee.
 * Different batches of an explicit *approved* failed-only retry require a
 * separately governed path (not implemented by this staging-only module).
 */
export function initialPayoutBatchKey(runId: number): string {
  if (!Number.isSafeInteger(runId) || runId <= 0) throw new Error("PAYOUT_RUN_INVALID");
  return `payroll-run-${runId}`;
}

export type PayoutLedgerStatus =
  | "prepared" | "submitting" | "submitted"
  | "succeeded" | "failed" | "reconciliation_required" | "cancelled";

const allowed: Record<PayoutLedgerStatus, readonly PayoutLedgerStatus[]> = {
  prepared: ["submitting", "cancelled"],
  submitting: ["submitted", "succeeded", "failed", "reconciliation_required"],
  submitted: ["succeeded", "failed", "reconciliation_required"],
  succeeded: [],
  failed: [], // manual retry must create an authorized new *batch attempt*
  reconciliation_required: [], // hold for authoritative provider reconciliation
  cancelled: [],
};
export function payoutTransitionAllowed(from: PayoutLedgerStatus, to: PayoutLedgerStatus): boolean {
  return allowed[from]?.includes(to) ?? false;
}
