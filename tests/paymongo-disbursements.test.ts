import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { employees, organizations, payrollEntries, payrollRuns } from "../src/db/schema";
import {
  assertWalletFunded,
  assessWalletFunding,
  buildBatchTransferPayload,
  buildPayrollRetryIdempotencyKey,
  choosePayrollRail,
  matchReceivingInstitution,
  parsePaymongoWallet,
  preflightPaymongoPayrollDisbursement,
  type PayrollPayoutRow,
} from "../src/lib/paymongo-disbursements";
import {
  normalizePaymongoTransferStatus,
  reconcilePaymongoPayrollTransfers,
  type PaymongoBatchSnapshot,
} from "../src/lib/payroll-payout-reconciliation";
import { derivePayrollPayoutState } from "../src/lib/payroll-payout-state";
import {
  normalizePaymongoTransferWebhook,
  verifyPaymongoWebhookSignature,
} from "../src/lib/paymongo-transfer-webhook";

const SOURCE = { number: "0000000001", name: "Acme Inc.", bic: "PAEYPHM2XXX" };

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
  const payload = buildBatchTransferPayload(rows, "pesonet", bics, SOURCE);

  assert.equal(payload.transfers.length, 2);
  assert.deepEqual(payload.transfers[0], {
    provider: "pesonet",
    amount: 5_000_00,
    currency: "PHP",
    source_account: SOURCE,
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
  assert.throws(() => buildBatchTransferPayload(rows, "pesonet", new Map(), SOURCE), /No resolved BIC/);
});

const WALLET_RESPONSE = {
  data: {
    id: "wallet_abc123",
    type: "wallet",
    attributes: {
      status: "active",
      balance: { available: 2_600_000, pending: 100_000 },
      account: { provider: "paymongo", account_name: "Acme Inc.", account_number: "0000000001", currency: "PHP" },
    },
  },
};

test("a wallet response yields the balance and the source account the batch needs", () => {
  const wallet = parsePaymongoWallet(WALLET_RESPONSE);
  assert.equal(wallet.id, "wallet_abc123");
  assert.equal(wallet.availableCents, 2_600_000);
  assert.equal(wallet.pendingCents, 100_000);
  assert.deepEqual(wallet.sourceAccount, { number: "0000000001", name: "Acme Inc.", bic: "PAEYPHM2XXX" });
  // Same data without the JSON:API attributes wrapper.
  assert.equal(parsePaymongoWallet({ data: { id: "w", ...WALLET_RESPONSE.data.attributes } }).availableCents, 2_600_000);
});

test("an unreadable wallet response fails closed instead of guessing a balance or account", () => {
  for (const bad of [null, {}, { data: { id: "w" } }, { data: { id: "w", balance: { available: "lots" }, account: {} } }]) {
    assert.throws(() => parsePaymongoWallet(bad), /did not include the balance and source account/);
  }
});

test("only available funds count, and a shortfall is reported to the centavo", () => {
  const wallet = parsePaymongoWallet(WALLET_RESPONSE);
  assert.equal(assessWalletFunding(wallet, 2_600_000).sufficient, true, "exactly enough is enough");
  const short = assessWalletFunding(wallet, 2_650_001);
  assert.equal(short.sufficient, false);
  assert.equal(short.shortfallCents, 50_001, "pending funds must not cover a payout");
  assert.throws(() => assertWalletFunded(wallet, 2_650_001), /Top up at least PHP 500\.01.*No transfer was attempted/);
  assert.throws(() => assertWalletFunded({ ...wallet, status: "deactivated" }, 1), /deactivated/);
  assert.doesNotThrow(() => assertWalletFunded(wallet, 2_600_000));
});

test("submission reads the wallet before creating the batch and attaches its source account", () => {
  const source = readFileSync("src/lib/paymongo-disbursements.ts", "utf8");
  const walletRead = source.search(/await getPaymongoWallet\(\);\s+assertWalletFunded/);
  const batchPost = source.indexOf('fetch("https://api.paymongo.com/v2/batch_transfers"');
  assert.ok(walletRead > 0 && batchPost > walletRead, "the funding check must run before the batch POST");
  assert.ok(source.includes("wallet.sourceAccount"), "transfers must use the wallet's own source account");
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
      employeeCount: 1,
      grossPay: "30000.00",
      netPay: "25000.00",
    }).returning();

    await db.insert(payrollEntries).values({
      payrollRunId: run.id,
      employeeId: employee.id,
      grossPay: "30000",
      deductions: "5000",
      netPay: "25000",
      trace: {
        payment: {
          employeeName: "Juan Dela Cruz",
          employeeNo: employee.employeeNo,
          firstName: employee.firstName,
          middleName: employee.middleName,
          lastName: employee.lastName,
          email: employee.email,
          bankAccount: employee.bankAccount,
          bankCode: employee.bankCode,
          mobile: employee.mobile,
        },
      },
    });

    process.env.PAYMONGO_SECRET_KEY = "sk_test_preflight_only";
    process.env.PAYMONGO_WALLET_ID = "wallet_abc123";
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      requestedUrls.push(url);
      assert.ok(!url.includes("/v2/batch_transfers"), "preflight must never create a batch transfer");
      assert.ok(!init?.method || init.method === "GET", "preflight must only read");
      if (url.endsWith("/v2/wallets/wallet_abc123")) {
        return new Response(JSON.stringify(WALLET_RESPONSE), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      assert.ok(url.includes("/v2/transfers/receiving_institutions"), "preflight must only read institutions and the wallet");
      return new Response(JSON.stringify({
        data: [{ attributes: { name: "BDO Unibank", bic: "BNORPHMM" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const result = await preflightPaymongoPayrollDisbursement(run.id);
    assert.equal(result.ready, true);
    assert.equal(result.wallet.availableCents, 2_600_000);
    assert.equal(result.wallet.shortfallCents, 0);
    assert.equal(result.employeeCount, 1);
    assert.equal(result.totalAmountCents, 2_500_000);
    assert.equal(result.provider, "instapay");
    assert.deepEqual(result.banks, [{ bankName: "BDO", bic: "BNORPHMM" }]);
    assert.equal(requestedUrls.length, 2, "one institutions read and one wallet read");
  } finally {
    globalThis.fetch = previousFetch;
    delete process.env.PAYMONGO_WALLET_ID;
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
    "authorizeTreasuryOperation",
    'requireReleaseSeparation: action === "retry-failed"',
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
  assert.ok(view.includes("PAYOUT CONTROL CENTER"));
  assert.ok(view.includes("Released net pay"));
  assert.ok(view.includes("Settled"));
  assert.ok(view.includes("Unsettled"));
  assert.ok(view.includes("Final variance"));
  assert.ok(view.includes("data-payout-transfer-ledger"));
  assert.ok(view.includes("data-payout-transfer-status"));
  assert.ok(view.includes("employeeByNo"));
});


test("PayMongo webhook signature verification uses the raw payload and rejects replayed timestamps", () => {
  const payload = '{"data":{"id":"evt_test","type":"event","attributes":{"type":"transfer.outward.successful"}}}';
  const secret = "whsec_paymongo_test";
  const nowMs = Date.parse("2026-10-01T00:00:00Z");
  const timestamp = String(Math.floor(nowMs / 1000));
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");

  assert.equal(verifyPaymongoWebhookSignature({
    payload,
    signatureHeader: `t=${timestamp},te=${signature},li=`,
    secret,
    nowMs,
  }), true);

  assert.equal(verifyPaymongoWebhookSignature({
    payload,
    signatureHeader: `t=${timestamp},te=${signature},li=`,
    secret,
    nowMs: nowMs + 10 * 60 * 1000,
  }), false);
});

test("PayMongo outward transfer webhooks map only canonical payroll references", () => {
  const event = normalizePaymongoTransferWebhook({
    data: {
      id: "evt_transfer_failed",
      type: "event",
      attributes: {
        type: "transfer.outward.failed",
        livemode: true,
        created_at: 1790812800,
        data: {
          id: "tr_failed",
          type: "wallet_transaction",
          attributes: {
            transfer_id: "tr_failed",
            batch_transaction_id: "batch_tr_123",
            reference_number: "PAY-77-E-002",
            amount: 2500000,
            provider: "pesonet",
            status: "failed",
            provider_error: "Beneficiary account could not be credited",
            provider_error_code: "BENEFICIARY_ACCOUNT_INVALID",
          },
        },
      },
    },
  });

  assert.ok(event);
  assert.equal(event.runId, 77);
  assert.equal(event.employeeNo, "E-002");
  assert.equal(event.status, "failed");
  assert.equal(event.providerErrorCode, "BENEFICIARY_ACCOUNT_INVALID");

  assert.equal(normalizePaymongoTransferWebhook({
    data: {
      id: "evt_other",
      attributes: {
        type: "transfer.outward.successful",
        data: { attributes: { transfer_id: "tr_x", reference_number: "OTHER-77-E-002", amount: 100, status: "succeeded" } },
      },
    },
  }), null);
});

test("a verified later transfer failure reopens a previously settled payroll", () => {
  const events = [
    {
      id: 1,
      actor: "Owner",
      action: "Payroll payout submitted via PayMongo",
      resource: "Sep 16-30",
      metadata: { runId: 77, batchId: "batch_tr_a", transferCount: 1 },
      createdAt: "2026-10-01T00:00:00Z",
    },
    {
      id: 2,
      actor: "Owner",
      action: "Payroll payout completed via PayMongo",
      resource: "Sep 16-30",
      metadata: {
        runId: 77,
        batchIds: ["batch_tr_a"],
        transferCount: 1,
        succeeded: 1,
        pending: 0,
        failed: 0,
        unknown: 0,
        completedAt: "2026-10-01T00:05:00Z",
        transfers: [{
          batchId: "batch_tr_a",
          transferId: "tr_1",
          referenceNumber: "PAY-77-E-001",
          employeeNo: "E-001",
          status: "succeeded",
          amountCents: 100000,
          providerReferenceNumber: "provider-1",
        }],
      },
      createdAt: "2026-10-01T00:05:00Z",
    },
    {
      id: 3,
      actor: "PayMongo webhook",
      action: "PayMongo transfer webhook received",
      resource: "Sep 16-30",
      metadata: {
        runId: 77,
        eventId: "evt_late_failure",
        batchId: "batch_tr_a",
        transferId: "tr_1",
        referenceNumber: "PAY-77-E-001",
        employeeNo: "E-001",
        status: "failed",
        amountCents: 100000,
        providerErrorCode: "AC03",
        providerError: "BlockedAccount",
        occurredAt: "2026-10-01T00:10:00Z",
      },
      createdAt: "2026-10-01T00:10:00Z",
    },
  ];

  const state = derivePayrollPayoutState(events, 77);
  assert.equal(state.payout.status, "submitted");
  assert.equal(state.reconciliation.status, "attention");
  assert.equal(state.reconciliation.failed, 1);
  assert.equal(state.reconciliation.settlementRegressed, true);
  assert.equal(state.reconciliation.transfers[0].providerErrorCode, "AC03");
});

test("PayMongo transfer webhook route is signed, duplicate-safe and exact-transfer scoped", () => {
  const route = readFileSync("src/app/api/webhooks/paymongo/transfers/route.ts", "utf8");
  const reconciliationRoute = readFileSync("src/app/api/payroll-runs/[id]/payout-reconciliation/route.ts", "utf8");
  const readiness = readFileSync("src/app/api/readiness/route.ts", "utf8");
  const view = readFileSync("src/components/workspace/exports.tsx", "utf8");

  for (const marker of [
    "PAYMONGO_WEBHOOK_SECRET",
    "request.text()",
    "paymongo-signature",
    "PayMongo transfer webhook received",
    "unmatched-payroll-transfer",
    "duplicate: true",
  ]) {
    assert.ok(route.includes(marker), `PayMongo transfer webhook route is missing ${marker}`);
  }

  assert.ok(reconciliationRoute.includes('searchParams.get("format") !== "csv"'));
  assert.ok(reconciliationRoute.includes("provider_error_code"));
  assert.ok(readiness.includes("signed transfer webhooks are configured"));
  assert.ok(view.includes("Reconciliation CSV"));
  assert.ok(view.includes("data-payout-settlement-regressed"));
});


test("live payout submission is serialized by PayMongo wallet", () => {
  const lock = readFileSync("src/lib/payout-submission-lock.ts", "utf8");
  const exportRoute = readFileSync("src/app/api/payroll-runs/[id]/exports/route.ts", "utf8");
  const reconciliationRoute = readFileSync("src/app/api/payroll-runs/[id]/payout-reconciliation/route.ts", "utf8");

  assert.ok(lock.includes("pg_try_advisory_lock"));
  assert.ok(lock.includes("PAYMONGO_WALLET_ID"));
  assert.ok(lock.includes("Another payroll payout is already being submitted"));
  assert.ok(exportRoute.includes("withPayrollPayoutSubmissionLock"));
  assert.ok(exportRoute.includes("createPaymongoPayrollDisbursement"));
  assert.ok(reconciliationRoute.includes("withPayrollPayoutSubmissionLock"));
  assert.ok(reconciliationRoute.includes("createPaymongoPayrollRetry"));
});


test("released payroll defaults to PayMongo preflight instead of requiring a bank file", () => {
  const state = derivePayrollPayoutState([], 501);
  assert.equal(state.payout.status, "awaiting-preflight");
  assert.equal(state.payout.method, "PayMongo");
  assert.match(state.payout.label, /PayMongo preflight/i);

  const passed = derivePayrollPayoutState([{
    id: 1,
    actor: "Owner",
    action: "PayMongo payroll preflight passed",
    resource: "Oct 1-15",
    metadata: {
      runId: 501,
      ready: true,
      wallet: { availableCents: 1000000, shortfallCents: 0 },
    },
    createdAt: "2026-10-04T00:00:00Z",
  }], 501);
  assert.equal(passed.payout.status, "ready");
  assert.equal(passed.payout.method, "PayMongo");
});

test("live PayMongo payout requires full provider config, explicit confirmation and recorded preflight", () => {
  const route = readFileSync("src/app/api/payroll-runs/[id]/exports/route.ts", "utf8");
  for (const marker of [
    "PAYMONGO_SECRET_KEY",
    "PAYMONGO_WALLET_ID",
    "PAYMONGO_WEBHOOK_SECRET",
    "PAYMONGO_DISBURSEMENTS_ENABLED",
    "body.confirm !== true",
    "PayMongo payroll preflight passed",
    "Run the no-money PayMongo preflight successfully",
  ]) {
    assert.ok(route.includes(marker), `live payout route is missing ${marker}`);
  }
});
