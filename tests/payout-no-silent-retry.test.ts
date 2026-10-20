import assert from "node:assert/strict";
import test from "node:test";
import {
  reconcilePaymongoPayrollTransfers,
  normalizePaymongoTransferStatus,
  type PaymongoBatchSnapshot,
  type PaymongoTransferSnapshot,
} from "../src/lib/payroll-payout-reconciliation";
import { payoutCentsFromNetPay } from "../src/lib/payout-ledger-rules";
import {
  buildPayrollRetryIdempotencyKey,
  type PayrollPayoutRow,
} from "../src/lib/paymongo-disbursements";
import {
  hasUnacknowledgedPaymongoRetry,
  PAYMONGO_RETRY_INTENT_ACTION,
  PAYMONGO_RETRY_SUBMITTED_ACTION,
} from "../src/lib/payroll-payout-retry-evidence";

// No connection to PayMongo, banks, real payroll, or external fixtures.
const runId = 2026;
const row = (employee: string, amountCents: number): PayrollPayoutRow => ({
  employeeNo: employee, employeeName: "Fictional " + employee,
  accountNumber: "0000000000", bankName: "Fictional Bank",
  amountCents, referenceNumber: "PAY-" + runId + "-" + employee,
});
const expected = [row("A", 125001), row("B", 287699), row("C", 50000)];
const transfer = (employee: string, batchId: string, status: "failed" | "pending" | "succeeded" | "unknown", id: string): PaymongoTransferSnapshot => ({
  batchId, transferId: id, referenceNumber: "PAY-" + runId + "-" + employee,
  status, amountCents: expected.find((x) => x.employeeNo === employee)!.amountCents,
  providerReferenceNumber: null,
});
const batch = (batchId: string, transfers: ReturnType<typeof transfer>[]): PaymongoBatchSnapshot => ({
  batchId, provider: "pesonet", transfers,
});
const first = () => batch("fictional-1", [
  transfer("A", "fictional-1", "succeeded", "tr-1"),
  transfer("B", "fictional-1", "failed", "tr-2"),
  transfer("C", "fictional-1", "pending", "tr-3"),
]);

test("centavo-exact multi-employee reconciliation never drops pending transfers", () => {
  assert.equal(payoutCentsFromNetPay("1250.01"), 125001);
  assert.equal(payoutCentsFromNetPay("2876.99"), 287699);
  assert.equal(payoutCentsFromNetPay("500.00"), 50000);
  const result = reconcilePaymongoPayrollTransfers({ runId, expectedRows: expected, batches: [first()] });
  assert.equal(result.total, 3);
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.pending, 1);
  assert.equal(result.unknown, 0);
  assert.equal(result.completed, false);
  assert.deepEqual(result.retryableReferences, ["PAY-2026-B"]);
  assert.equal(result.transfers.reduce((sum, t) => sum + t.amountCents, 0), 462700);
});

test("authorized failed-only retry replaces exactly one reference, preserves other frozen statuses", () => {
  const retry = batch("fictional-retry", [transfer("B", "fictional-retry", "succeeded", "tr-4")]);
  const result = reconcilePaymongoPayrollTransfers({ runId, expectedRows: expected, batches: [first(), retry] });
  assert.equal(result.total, 3);
  assert.equal(result.succeeded, 2);
  assert.equal(result.pending, 1);
  assert.equal(result.failed, 0);
  assert.deepEqual(result.retryableReferences, []);
  assert.equal(result.transfers.find(t => t.employeeNo === "A")?.batchId, "fictional-1");
  assert.equal(result.transfers.find(t => t.employeeNo === "B")?.batchId, "fictional-retry");
  assert.equal(result.transfers.find(t => t.employeeNo === "C")?.status, "pending");
  const key = buildPayrollRetryIdempotencyKey(runId, ["fictional-1"], ["PAY-2026-B"]);
  assert.equal(key, buildPayrollRetryIdempotencyKey(runId, ["fictional-1"], ["PAY-2026-B"]));
  assert.notEqual(key, buildPayrollRetryIdempotencyKey(runId, ["fictional-1"], ["PAY-2026-A"]));
});

test("provider duplicate batch and transfer identifiers never silently overwrite an employee", () => {
  assert.throws(() => reconcilePaymongoPayrollTransfers({
    runId, expectedRows: expected, batches: [first(), first()],
  }), /DUPLICATE_OR_INVALID_BATCH/);
  for (const malformed of [
    batch("fictional-1", [...first().transfers, transfer("A", "fictional-1", "failed", "tr-99")]),
    batch("fictional-1", [...first().transfers, transfer("B", "fictional-1", "failed", "tr-2")]),
    batch("fictional-1", [
      transfer("A", "fictional-1", "succeeded", "tr-1"),
      transfer("B", "fictional-1", "failed", "tr-1"),
      transfer("C", "fictional-1", "pending", "tr-3"),
    ]),
  ]) assert.throws(() => reconcilePaymongoPayrollTransfers({
    runId, expectedRows: expected, batches: [malformed],
  }), /DUPLICATE_OR_INVALID_TRANSFER/);
});

test("provider retries of succeeded, pending and unknown transfers fail closed", () => {
  for (const priorStatus of ["succeeded", "pending", "unknown"] as const) {
    const initial = first();
    initial.transfers[0] = transfer("A", "fictional-1", priorStatus, "tr-1");
    const illegal = batch("fictional-retry", [transfer("A", "fictional-retry", "succeeded", "tr-4")]);
    assert.throws(() => reconcilePaymongoPayrollTransfers({
      runId, expectedRows: expected, batches: [initial, illegal],
    }), /PAYOUT_RECONCILIATION_UNSAFE_RETRY_/);
  }
});

test("wrong-provider IDs, invalid cents, and vanished transfers require manual reconciliation", () => {
  const mismatched = first();
  mismatched.transfers[0] = { ...mismatched.transfers[0], batchId: "other-batch" };
  assert.throws(() => reconcilePaymongoPayrollTransfers({
    runId, expectedRows: expected, batches: [mismatched],
  }), /DUPLICATE_OR_INVALID_TRANSFER/);
  const fractional = first();
  fractional.transfers[1] = { ...fractional.transfers[1], amountCents: 287699.5 };
  assert.throws(() => reconcilePaymongoPayrollTransfers({
    runId, expectedRows: expected, batches: [fractional],
  }), /amount mismatch/);
  const missing = first();
  missing.transfers.pop();
  assert.throws(() => reconcilePaymongoPayrollTransfers({
    runId, expectedRows: expected, batches: [missing],
  }), /missing 1 released payroll transfer/);
  const foreign = first();
  foreign.transfers[1] = { ...foreign.transfers[1], referenceNumber: "PAY-2027-FOREIGN" };
  assert.throws(() => reconcilePaymongoPayrollTransfers({
    runId, expectedRows: expected, batches: [foreign],
  }), /does not belong to payroll run/);
});

test("duplicate released rows or mutated net cents cannot silently reconcile", () => {
  assert.throws(() => reconcilePaymongoPayrollTransfers({
    runId, expectedRows: [...expected, { ...expected[0] }], batches: [first()],
  }), /DUPLICATE_OR_INVALID_RELEASED_ROW/);
  assert.throws(() => reconcilePaymongoPayrollTransfers({
    runId, expectedRows: [...expected.slice(0, 1), { ...expected[1], amountCents: 287698 }, expected[2]],
    batches: [first()],
  }), /amount mismatch/);
  assert.throws(() => reconcilePaymongoPayrollTransfers({
    runId, expectedRows: [{ ...expected[0], amountCents: Number.NaN }, ...expected.slice(1)],
    batches: [first()],
  }), /DUPLICATE_OR_INVALID_RELEASED_ROW/);
  assert.throws(() => reconcilePaymongoPayrollTransfers({
    runId, expectedRows: [], batches: [],
  }), /INVALID_INPUT/);
});

test("uncertain retry intent holds the no-resend gate until the exact same key is acknowledged", () => {
  const intent = { action: PAYMONGO_RETRY_INTENT_ACTION, metadata: { idempotencyKey: "dryrun-key" } };
  const unrelated = { action: PAYMONGO_RETRY_SUBMITTED_ACTION, metadata: { idempotencyKey: "other-key" } };
  const receipt = { action: PAYMONGO_RETRY_SUBMITTED_ACTION, metadata: { idempotencyKey: "dryrun-key" } };
  assert.equal(hasUnacknowledgedPaymongoRetry([intent]), true);
  assert.equal(hasUnacknowledgedPaymongoRetry([intent, unrelated]), true);
  assert.equal(hasUnacknowledgedPaymongoRetry([intent, receipt]), false);
  assert.equal(normalizePaymongoTransferStatus("UNRECOGNIZED_STATUS"), "unknown");
});
