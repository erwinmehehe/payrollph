import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  auditEvents, employees, organizations, payrollEntries, payrollRuns,
  payoutBatches, payoutTransfers, payoutBatchTransfers,
} from "../src/db/schema";
import {
  claimPreparedPayoutBatch, markPayoutBatchForReconciliation, prepareInitialPayoutBatch,
  recordPayoutProviderBatchResponse,
} from "../src/lib/payout-ledger";
import {
  canonicalPayoutIntents, initialPayoutBatchKey, payoutBatchFingerprint,
  payoutCentsFromNetPay, payoutTransitionAllowed,
} from "../src/lib/payout-ledger-rules";

function freshName() { return `Synthetic A2 payout ledger ${randomUUID()}`; }

async function fixture() {
  const [org] = await db.insert(organizations).values({
    name: freshName(), legalName: "Synthetic Employer — No Money Movement",
  }).returning({ id: organizations.id });
  const persons = await db.insert(employees).values([
    { organizationId: org.id, employeeNo: "A2-001", firstName: "Synthetic", lastName: "One",
      title: "Tester", avatarInitials: "SO", basicRate: "30000.00", startDate: "2026-10-01" },
    { organizationId: org.id, employeeNo: "A2-002", firstName: "Synthetic", lastName: "Two",
      title: "Tester", avatarInitials: "ST", basicRate: "30000.00", startDate: "2026-10-01" },
  ]).returning({ id: employees.id, employeeNo: employees.employeeNo });
  const [run] = await db.insert(payrollRuns).values({
    organizationId: org.id, periodLabel: "Synthetic A2 ledger (no transfers)",
    periodStart: "2026-10-01", periodEnd: "2026-10-15", payDate: "2026-10-20",
    status: "Released", employeeCount: 2, netPay: "1500.00",
    grossPay: "1500.00",
  }).returning({ id: payrollRuns.id });
  const entries = await db.insert(payrollEntries).values([
    { payrollRunId: run.id, employeeId: persons[0].id, grossPay: "500.00",
      deductions: "0.00", netPay: "500.00", status: "Ready" },
    { payrollRunId: run.id, employeeId: persons[1].id, grossPay: "1000.00",
      deductions: "0.00", netPay: "1000.00", status: "Ready" },
  ]).returning({ id: payrollEntries.id, employeeId: payrollEntries.employeeId });
  const intents = entries.map((entry, i) => ({
    employeeId: entry.employeeId, payrollEntryId: entry.id,
    amountCents: i === 0 ? 50000 : 100000,
    referenceNumber: `PAY-${run.id}-${persons[i].employeeNo}`,
  }));
  return { orgId: org.id, runId: run.id, intents };
}
async function cleanup(orgId: number) {
  await db.delete(payoutBatchTransfers).where(eq(payoutBatchTransfers.organizationId, orgId));
  await db.delete(payoutTransfers).where(eq(payoutTransfers.organizationId, orgId));
  await db.delete(payoutBatches).where(eq(payoutBatches.organizationId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
}

test("initial batch holds one idempotency key for TWO employees, with immutable positive amounts", async () => {
  const source = await fixture();
  try {
    const result = await prepareInitialPayoutBatch({
      organizationId: source.orgId, payrollRunId: source.runId, intents: source.intents,
    });
    assert.equal(result.transferCount, 2);
    assert.equal(result.totalAmountCents, 150000);
    assert.equal(result.idempotencyKey, `payroll-run-${source.runId}`);
    assert.match(result.requestHash, /^[a-f0-9]{64}$/);
    const stored = await db.select().from(payoutTransfers).where(eq(payoutTransfers.organizationId, source.orgId));
    const batches = await db.select().from(payoutBatches).where(eq(payoutBatches.organizationId, source.orgId));
    assert.equal(stored.length, 2);
    assert.equal(batches.length, 1);
    assert.equal(stored.every((x) => x.status === "prepared"), true);
    await assert.rejects(prepareInitialPayoutBatch({
      organizationId: source.orgId, payrollRunId: source.runId, intents: source.intents,
    }), /PAYOUT_BATCH_ALREADY_PREPARED/);
  } finally { await cleanup(source.orgId); }
});

test("two serverless workers competing to claim same batch produce exactly one winner", async () => {
  const source = await fixture();
  try {
    const prepared = await prepareInitialPayoutBatch({
      organizationId: source.orgId, payrollRunId: source.runId, intents: source.intents,
    });
    const [left, right] = await Promise.all([
      claimPreparedPayoutBatch({ organizationId: source.orgId, batchId: prepared.batchId }),
      claimPreparedPayoutBatch({ organizationId: source.orgId, batchId: prepared.batchId }),
    ]);
    assert.equal(Number(left !== null) + Number(right !== null), 1);
    assert.equal(left?.idempotencyKey ?? right?.idempotencyKey, prepared.idempotencyKey);
    assert.equal(await claimPreparedPayoutBatch({
      organizationId: source.orgId, batchId: prepared.batchId,
    }), null);
    const marked = await markPayoutBatchForReconciliation({
      organizationId: source.orgId, batchId: prepared.batchId,
    });
    assert.equal(marked, true);
    assert.equal(await markPayoutBatchForReconciliation({
      organizationId: source.orgId, batchId: prepared.batchId,
    }), false);
    const batches = await db.select().from(payoutBatches)
      .where(eq(payoutBatches.id, prepared.batchId));
    assert.equal(batches[0].status, "reconciliation_required");
    const transfers = await db.select().from(payoutTransfers)
      .where(eq(payoutTransfers.organizationId, source.orgId));
    assert.ok(transfers.every((x) => x.status === "reconciliation_required"));
  } finally { await cleanup(source.orgId); }
});

test("a foreign tenant cannot prepare, claim or reconcile another tenant's payout", async () => {
  const source = await fixture();
  const other = await db.insert(organizations).values({
    name: freshName(), legalName: "Foreign Tenant — Synthetic",
  }).returning({ id: organizations.id });
  try {
    await assert.rejects(prepareInitialPayoutBatch({
      organizationId: other[0].id, payrollRunId: source.runId, intents: source.intents,
    }), /PAYOUT_RELEASE_AND_TENANT_VERIFICATION_REQUIRED/);
    const prepared = await prepareInitialPayoutBatch({
      organizationId: source.orgId, payrollRunId: source.runId, intents: source.intents,
    });
    assert.equal(await claimPreparedPayoutBatch({
      organizationId: other[0].id, batchId: prepared.batchId,
    }), null);
    assert.equal(await markPayoutBatchForReconciliation({
      organizationId: other[0].id, batchId: prepared.batchId,
    }), false);
  } finally {
    await cleanup(source.orgId);
    await cleanup(other[0].id);
  }
});

test("legacy payout audit blocks silent re-adoption as a new, unpaid batch", async () => {
  const source = await fixture();
  try {
    await db.insert(auditEvents).values({
      organizationId: source.orgId, actor: "Synthetic test",
      action: "Payroll payout submitted via PayMongo", resource: "synthetic only",
      metadata: { runId: source.runId, moneyMovedByLinaw: true },
    });
    await assert.rejects(prepareInitialPayoutBatch({
      organizationId: source.orgId, payrollRunId: source.runId, intents: source.intents,
    }), /PAYOUT_EXISTING_LEGACY_PAYMENT_REQUIRES_RECONCILIATION/);
  } finally { await cleanup(source.orgId); }
});

test("staged intent rejects tampered amount and reference before any DB insert", async () => {
  const source = await fixture();
  try {
    await assert.rejects(prepareInitialPayoutBatch({
      organizationId: source.orgId, payrollRunId: source.runId,
      intents: source.intents.map((item, i) => i === 0 ? { ...item, amountCents: item.amountCents + 1 } : item),
    }), /PAYOUT_FROZEN_ENTRY_AMOUNT_MISMATCH/);
    await assert.rejects(prepareInitialPayoutBatch({
      organizationId: source.orgId, payrollRunId: source.runId,
      intents: source.intents.map((item, i) => i === 0 ? { ...item, referenceNumber: "PAY-999-HIJACK" } : item),
    }), /PAYOUT_TENANT_OR_REFERENCE_MISMATCH/);
    assert.equal((await db.select().from(payoutBatches).where(eq(payoutBatches.organizationId, source.orgId))).length, 0);
  } finally { await cleanup(source.orgId); }
});

test("centavo and state rules never permit an implicit re-send after unknown outcome", () => {
  assert.equal(payoutCentsFromNetPay("11733.33"), 1173333);
  assert.equal(payoutCentsFromNetPay("0"), 0);
  for (const invalid of ["-10.00", "1.001", "12,345.00", "NaN", "1e4"]) {
    assert.throws(() => payoutCentsFromNetPay(invalid));
  }
  assert.ok(payoutTransitionAllowed("prepared", "submitting"));
  assert.ok(!payoutTransitionAllowed("submitting", "prepared"));
  assert.ok(!payoutTransitionAllowed("reconciliation_required", "prepared"));
  assert.ok(!payoutTransitionAllowed("succeeded", "failed"));
  assert.equal(initialPayoutBatchKey(42), "payroll-run-42");
  assert.equal(payoutBatchFingerprint([
    { employeeId: 2, payrollEntryId: 2, amountCents: 200, referenceNumber: "PAY-3-E2" },
    { employeeId: 1, payrollEntryId: 1, amountCents: 100, referenceNumber: "PAY-3-E1" },
  ]), payoutBatchFingerprint([
    { employeeId: 1, payrollEntryId: 1, amountCents: 100, referenceNumber: "PAY-3-E1" },
    { employeeId: 2, payrollEntryId: 2, amountCents: 200, referenceNumber: "PAY-3-E2" },
  ]));
  assert.throws(() => canonicalPayoutIntents([
    { employeeId: 1, payrollEntryId: 1, amountCents: 100, referenceNumber: "PAY-3-E1" },
    { employeeId: 1, payrollEntryId: 2, amountCents: 200, referenceNumber: "PAY-3-E2" },
  ]), /PAYOUT_INVALID_OR_DUPLICATED_TRANSFER/);
});

test("pending SQL keeps batch key unique and immutable transfer fields protected", () => {
  const source = readFileSync("docs/sql/pending-payout-ledger.sql", "utf8");
  assert.match(source, /payout_batches_provider_idempotency_unique/);
  assert.match(source, /payout_transfers_run_employee_unique/);
  assert.match(source, /protect_payout_transfer_identity/);
  assert.match(source, /payout_batch_transfers_batch_transfer_unique/);
  const runtime = readFileSync("src/lib/payout-ledger.ts", "utf8");
  assert.ok(runtime.includes('eq(payoutBatches.status, "prepared")'));
  assert.ok(runtime.includes('eq(payoutTransfers.status, "prepared")'));
  assert.ok(!runtime.includes("createPaymongoBatchDisbursement("));
  assert.ok(!runtime.includes("PAYMONGO_SECRET_KEY"));
});


test("provider acknowledgement requires the exact two-person frozen batch and is NOT settlement", async () => {
  const source = await fixture();
  try {
    const prepared = await prepareInitialPayoutBatch({
      organizationId: source.orgId, payrollRunId: source.runId, intents: source.intents,
    });
    const claim = await claimPreparedPayoutBatch({ organizationId: source.orgId, batchId: prepared.batchId });
    assert.ok(claim);
    const accepted = source.intents.map((item, index) => ({
      referenceNumber: item.referenceNumber, amountCents: item.amountCents,
      providerTransferId: `tr_synthetic_a2_${index}_${prepared.batchId}`,
    }));
    await assert.rejects(recordPayoutProviderBatchResponse({
      organizationId: source.orgId, batchId: prepared.batchId,
      providerBatchId: `batch_tr_synthetic_${prepared.batchId}`,
      transfers: accepted.map((item, index) => index === 0 ? { ...item, amountCents: item.amountCents + 1 } : item),
    }), /PAYOUT_PROVIDER_ACK_IDENTITY_OR_STATE_MISMATCH/);
    const [afterRejected] = await db.select().from(payoutBatches).where(eq(payoutBatches.id, prepared.batchId));
    assert.equal(afterRejected.status, "submitting", "invalid provider data must roll back fully");

    assert.equal(await recordPayoutProviderBatchResponse({
      organizationId: source.orgId, batchId: prepared.batchId,
      providerBatchId: `batch_tr_synthetic_${prepared.batchId}`, transfers: accepted,
    }), true);
    assert.equal(await recordPayoutProviderBatchResponse({
      organizationId: source.orgId, batchId: prepared.batchId,
      providerBatchId: `batch_tr_synthetic_${prepared.batchId}`, transfers: accepted,
    }), false, "same batch must not be acknowledged a second time");
    const [batch] = await db.select().from(payoutBatches).where(eq(payoutBatches.id, prepared.batchId));
    assert.equal(batch.status, "submitted");
    assert.equal(batch.providerBatchId, `batch_tr_synthetic_${prepared.batchId}`);
    const transfers = await db.select().from(payoutTransfers)
      .where(eq(payoutTransfers.organizationId, source.orgId));
    assert.ok(transfers.every((item) => item.status === "submitted"));
    assert.ok(!transfers.some((item) => item.status === "succeeded"));
  } finally { await cleanup(source.orgId); }
});

test("ambiguous claimed provider response cannot be retried as a fresh payout batch", async () => {
  const source = await fixture();
  try {
    const staged = await prepareInitialPayoutBatch({
      organizationId: source.orgId, payrollRunId: source.runId, intents: source.intents,
    });
    await claimPreparedPayoutBatch({ organizationId: source.orgId, batchId: staged.batchId });
    assert.equal(await markPayoutBatchForReconciliation({
      organizationId: source.orgId, batchId: staged.batchId,
    }), true);
    assert.equal(await recordPayoutProviderBatchResponse({
      organizationId: source.orgId, batchId: staged.batchId, providerBatchId: "batch_tr_late",
      transfers: source.intents.map((row, index) => ({
        referenceNumber: row.referenceNumber, amountCents: row.amountCents,
        providerTransferId: `tr_late_${index}`,
      })),
    }), false, "late ACK requires explicit reconciliation, not silent state change");
    await assert.rejects(prepareInitialPayoutBatch({
      organizationId: source.orgId, payrollRunId: source.runId, intents: source.intents,
    }), /PAYOUT_BATCH_ALREADY_PREPARED/);
  } finally { await cleanup(source.orgId); }
});
