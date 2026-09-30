import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { employees, organizations, payrollEntries, payrollRuns } from "../src/db/schema";
import {
  buildBatchTransferPayload,
  buildPayrollRetryIdempotencyKey,
  choosePayrollRail,
  matchReceivingInstitution,
  preflightPaymongoPayrollDisbursement,
  type PayrollPayoutRow,
} from "../src/lib/paymongo-disbursements";
import {
  normalizePaymongoTransferStatus,
  reconcilePaymongoPayrollTransfers,
  type PaymongoBatchSnapshot,
} from "../src/lib/payroll-payout-reconciliation";

function row(overrides: Partial<PayrollPayoutRow> = {}): PayrollPayoutRow {
  return {
    employeeNo: "E-001",
    employeeName: "Juan Dela Cruz",
    accountNumber: "1234567890",
    bankName: "BDO",
    amountCents: 5_000_00,
    referenceNumber: "PAY-1-E-001",
    ...overrides,
  };
}

test("a real payroll batch (>1 employee) always uses PESONet, per PayMongo's own payroll guidance", () => {
  const rows = [row(), row({ employeeNo: "E-002" })];
  assert.equal(choosePayrollRail(rows), "pesonet");
});

test("a payroll batch is routed to PESONet even when every row is individually under the InstaPay cap", () => {
  const rows = [row({ amountCents: 10_00 }), row({ employeeNo: "E-002", amountCents: 10_00 })];
  assert.equal(choosePayrollRail(rows), "pesonet");
});

test("a single small correction payout can use InstaPay", () => {
  const rows = [row({ amountCents: 20_000_00 })];
  assert.equal(choosePayrollRail(rows), "instapay");
});

test("a single payout over the InstaPay cap still uses PESONet", () => {
  const rows = [row({ amountCents: 60_000_00 })];
  assert.equal(choosePayrollRail(rows), "pesonet");
});

test("PESONet is used for a batch that mixes small and large amounts, matching PayMongo's one-rail-per-batch rule", () => {
  const rows = [row({ amountCents: 10_00 }), row({ employeeNo: "E-002", amountCents: 60_000_00 })];
  assert.equal(choosePayrollRail(rows), "pesonet");
});

test("matchReceivingInstitution finds a bank by partial, case-insensitive name", () => {
  const institutions = [
    { name: "BDO Unibank", bic: "BNORPHMM" },
    { name: "Bank of the Philippine Islands", bic: "BOPIPHMM" },
  ];
  assert.equal(matchReceivingInstitution("bdo", institutions).bic, "BNORPHMM");
});

test("matchReceivingInstitution throws rather than guessing when nothing matches", () => {
  assert.throws(
    () => matchReceivingInstitution("Some Unlisted Bank", [{ name: "BDO Unibank", bic: "BNORPHMM" }]),
    /No receiving institution matched/,
  );
});

test("buildBatchTransferPayload produces the documented Transfer V2 field shape", () => {
  const rows = [row(), row({ employeeNo: "E-002", employeeName: "Maria Santos", bankName: "BPI" })];
  const bics = new Map([
    ["BDO", "BNORPHMM"],
    ["BPI", "BOPIPHMM"],
  ]);
  const payload = buildBatchTransferPayload(rows, "pesonet", bics);

  assert.equal(payload.transfers.length, 2);
  assert.deepEqual(payload.transfers[0], {
    provider: "pesonet",
    amount: 5_000_00,
    currency: "PHP",
    destination_account: {
      number: "1234567890",
      name: "Juan Dela Cruz",
      bic: "BNORPHMM",
    },
    reference_number: "PAY-1-E-001",
    purpose: "Payroll disbursement",
    description: "Payroll payout for Juan Dela Cruz (E-001)",
  });
  assert.equal(payload.transfers[1].destination_account.bic, "BOPIPHMM");
});

test("buildBatchTransferPayload refuses to silently omit a BIC it couldn't resolve", () => {
  const rows = [row({ bankName: "Unmapped Bank" })];
  assert.throws(() => buildBatchTransferPayload(rows, "pesonet", new Map()), /No resolved BIC/);
});


test("PayMongo payroll preflight validates live bank mapping without creating a transfer", async () => {
  const [org] = await db.insert(organizations).values({
    name: "PayMongo Preflight Test",
    legalName: "PayMongo Preflight Test Inc.",
  }).returning();

  const previousSecret = process.env.PAYMONGO_SECRET_KEY;
  const previousFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "PAY-001",
      firstName: "Juan",
      lastName: "Dela Cruz",
      title: "Staff",
      avatarInitials: "JD",
      basicRate: "30000",
      bankAccount: "1234567890",
      bankCode: "BDO",
      startDate: "2026-01-01",
    }).returning();

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Sep 16–30, 2026",
      periodStart: "2026-09-16",
      periodEnd: "2026-09-30",
      payDate: "2026-09-30",
      status: "Released",
    }).returning();

    await db.insert(payrollEntries).values({
      payrollRunId: run.id,
      employeeId: employee.id,
      grossPay: "30000",
      deductions: "5000",
      netPay: "25000",
    });

    process.env.PAYMONGO_SECRET_KEY = "sk_test_preflight_only";
    globalThis.fetch = async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      assert.ok(url.includes("/v2/transfers/receiving_institutions"), "preflight must only read receiving institutions");
      assert.ok(!url.includes("/v2/batch_transfers"), "preflight must never create a batch transfer");
      return new Response(JSON.stringify({
        data: [{ attributes: { name: "BDO Unibank", bic: "BNORPHMM" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const result = await preflightPaymongoPayrollDisbursement(run.id);
    assert.equal(result.ready, true);
    assert.equal(result.employeeCount, 1);
    assert.equal(result.totalAmountCents, 2_500_000);
    assert.equal(result.provider, "instapay");
    assert.deepEqual(result.banks, [{ bankName: "BDO", bic: "BNORPHMM" }]);
    assert.equal(requestedUrls.length, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousSecret === undefined) delete process.env.PAYMONGO_SECRET_KEY;
    else process.env.PAYMONGO_SECRET_KEY = previousSecret;
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});


test("PayMongo transfer reconciliation keeps the newest status for retried references", () => {
  const expectedRows = [
    row({ employeeNo: "E-001", referenceNumber: "PAY-77-E-001", amountCents: 1_000_00 }),
    row({ employeeNo: "E-002", referenceNumber: "PAY-77-E-002", amountCents: 2_000_00 }),
    row({ employeeNo: "E-003", referenceNumber: "PAY-77-E-003", amountCents: 3_000_00 }),
  ];
  const batches: PaymongoBatchSnapshot[] = [
    {
      batchId: "batch_tr_original",
      provider: "pesonet",
      transfers: [
        { batchId: "batch_tr_original", transferId: "tr_1", referenceNumber: "PAY-77-E-001", status: "succeeded", amountCents: 1_000_00, providerReferenceNumber: "P-1" },
        { batchId: "batch_tr_original", transferId: "tr_2", referenceNumber: "PAY-77-E-002", status: "failed", amountCents: 2_000_00, providerReferenceNumber: null },
        { batchId: "batch_tr_original", transferId: "tr_3", referenceNumber: "PAY-77-E-003", status: "pending", amountCents: 3_000_00, providerReferenceNumber: null },
      ],
    },
    {
      batchId: "batch_tr_retry",
      provider: "instapay",
      transfers: [
        { batchId: "batch_tr_retry", transferId: "tr_4", referenceNumber: "PAY-77-E-002", status: "succeeded", amountCents: 2_000_00, providerReferenceNumber: "P-4" },
      ],
    },
  ];

  const result = reconcilePaymongoPayrollTransfers({ runId: 77, expectedRows, batches });
  assert.equal(result.succeeded, 2);
  assert.equal(result.pending, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.completed, false);
  assert.deepEqual(result.retryableReferences, []);
  assert.equal(result.transfers.find((transfer) => transfer.employeeNo === "E-002")?.batchId, "batch_tr_retry");
});

test("PayMongo reconciliation retries failed references only and never pending transfers", () => {
  const expectedRows = [
    row({ employeeNo: "E-001", referenceNumber: "PAY-88-E-001", amountCents: 1_000_00 }),
    row({ employeeNo: "E-002", referenceNumber: "PAY-88-E-002", amountCents: 2_000_00 }),
  ];
  const result = reconcilePaymongoPayrollTransfers({
    runId: 88,
    expectedRows,
    batches: [{
      batchId: "batch_tr_status",
      provider: "pesonet",
      transfers: [
        { batchId: "batch_tr_status", transferId: "tr_a", referenceNumber: "PAY-88-E-001", status: "failed", amountCents: 1_000_00, providerReferenceNumber: null },
        { batchId: "batch_tr_status", transferId: "tr_b", referenceNumber: "PAY-88-E-002", status: "pending", amountCents: 2_000_00, providerReferenceNumber: null },
      ],
    }],
  });

  assert.deepEqual(result.retryableReferences, ["PAY-88-E-001"]);
  assert.equal(result.failed, 1);
  assert.equal(result.pending, 1);
});

test("PayMongo reconciliation fails closed on unexpected references or changed amounts", () => {
  const expectedRows = [row({ employeeNo: "E-001", referenceNumber: "PAY-99-E-001", amountCents: 5_000_00 })];

  assert.throws(
    () => reconcilePaymongoPayrollTransfers({
      runId: 99,
      expectedRows,
      batches: [{
        batchId: "batch_tr_wrong_ref",
        provider: "instapay",
        transfers: [{ batchId: "batch_tr_wrong_ref", transferId: "tr_x", referenceNumber: "PAY-99-E-999", status: "succeeded", amountCents: 5_000_00, providerReferenceNumber: null }],
      }],
    }),
    /does not belong to payroll run/,
  );

  assert.throws(
    () => reconcilePaymongoPayrollTransfers({
      runId: 99,
      expectedRows,
      batches: [{
        batchId: "batch_tr_wrong_amount",
        provider: "instapay",
        transfers: [{ batchId: "batch_tr_wrong_amount", transferId: "tr_y", referenceNumber: "PAY-99-E-001", status: "succeeded", amountCents: 4_999_00, providerReferenceNumber: null }],
      }],
    }),
    /amount mismatch/,
  );
});

test("retry idempotency is stable for the same failed set and changes for a different operation", () => {
  const first = buildPayrollRetryIdempotencyKey(77, ["batch_tr_a"], ["PAY-77-E-002", "PAY-77-E-001"]);
  const reordered = buildPayrollRetryIdempotencyKey(77, ["batch_tr_a"], ["PAY-77-E-001", "PAY-77-E-002"]);
  const different = buildPayrollRetryIdempotencyKey(77, ["batch_tr_a"], ["PAY-77-E-001"]);
  assert.equal(first, reordered);
  assert.notEqual(first, different);
});

test("provider status normalization recognizes only PayMongo documented settlement states", () => {
  assert.equal(normalizePaymongoTransferStatus("pending"), "pending");
  assert.equal(normalizePaymongoTransferStatus("succeeded"), "succeeded");
  assert.equal(normalizePaymongoTransferStatus("failed"), "failed");
  assert.equal(normalizePaymongoTransferStatus("paid"), "unknown");
});

test("payout reconciliation route and UI enforce failed-only retry semantics", () => {
  const route = readFileSync("src/app/api/payroll-runs/[id]/payout-reconciliation/route.ts", "utf8");
  const exportRoute = readFileSync("src/app/api/payroll-runs/[id]/exports/route.ts", "utf8");
  const view = readFileSync("src/components/workspace/exports.tsx", "utf8");

  for (const marker of [
    "Only the workspace owner can reconcile or retry payroll payouts.",
    "Pending transfers must not be resent.",
    'body.action === "retry-failed"',
    "retryableReferences",
    "Payroll payout retry submitted via PayMongo",
    "settlementVerified: input.reconciliation.completed",
  ]) {
    assert.ok(route.includes(marker), `reconciliation route is missing ${marker}`);
  }

  assert.ok(exportRoute.includes("already has a PayMongo payout batch"));
  assert.ok(exportRoute.includes('transfer.status.toLowerCase() === "succeeded"'));
  assert.ok(view.includes("PayMongo reconciliation"));
  assert.ok(view.includes("Refresh PayMongo status"));
  assert.ok(view.includes("failed only"));
  assert.ok(view.includes('data-payout-transfer-list'));
  assert.ok(view.includes('payoutState.reconciliation.provider !== "PayMongo"'));
});
