import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  auditEvents, employees, organizations, payrollEntries, payrollRuns,
  userOrganizations, users,
} from "../src/db/schema";

const require = createRequire(import.meta.url);

// Real HTTP GET/POST handlers, real PostgreSQL transaction-scoped run/wallet
// locks and real audit writes. No bank upload or provider network is allowed.
// Framework auth, treasury policy, MFA and bank formatter are synthetic shims.
function isolatedDatabase() {
  try {
    const u = new URL(process.env.DATABASE_URL ?? "");
    return process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true"
      && u.hostname === "127.0.0.1" && u.port === "5432"
      && u.pathname === "/app_db" && u.username === "postgres"
      && !u.search && !u.hash;
  } catch { return false; }
}

test("actual HTTP PayMongo POST and final bank GET cannot double-claim a released payroll", {
  skip: !isolatedDatabase(), timeout: 90_000,
}, async () => {
  const suffix = randomUUID();
  const [org] = await db.insert(organizations).values({
    name: "Synthetic payout concurrency " + suffix,
    legalName: "Fictional Bank Race Employer",
  }).returning();
  const [operator] = await db.insert(users).values({
    email: "bank-race-" + suffix + "@example.invalid", name: "Fictional Treasury Operator",
    role: "owner", passwordHash: "not-a-login",
  }).returning();
  const restores: Array<() => void> = [];
  const keys = [
    "PAYMONGO_SECRET_KEY", "PAYMONGO_WALLET_ID", "PAYMONGO_WEBHOOK_SECRET",
    "PAYMONGO_DISBURSEMENTS_ENABLED", "PAYROLL_PAYOUT_PROVIDER", "APP_BASE_URL",
  ] as const;
  const previousEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  function patch(path: string, fields: Record<string, unknown>) {
    const id = require.resolve(path);
    const prior = require(id);
    require.cache[id]!.exports = { ...prior, ...fields };
    restores.push(() => { require.cache[id]!.exports = prior; });
  }

  try {
    await db.insert(userOrganizations).values({
      userId: operator.id, organizationId: org.id, role: "owner", active: true,
    });
    const [worker] = await db.insert(employees).values({
      organizationId: org.id, employeeNo: "SYN-" + suffix.slice(0, 10),
      firstName: "Fictional", lastName: "Worker", title: "Test-only employee",
      avatarInitials: "FW", basicRate: "20000.00", startDate: "2026-01-01",
      bankAccount: "1234567890", bankCode: "BDO",
    }).returning();
    // Each released run needs its own genuine cutoff. 0089's overlap guard
    // must remain active while these independent payout-rail races are tested.
    const cutoffs = [
      ["2026-07-01", "2026-07-15", "2026-07-16"],
      ["2026-07-16", "2026-07-31", "2026-08-01"],
      ["2026-08-01", "2026-08-15", "2026-08-16"],
      ["2026-08-16", "2026-08-31", "2026-09-01"],
      ["2026-09-01", "2026-09-15", "2026-09-16"],
      ["2026-09-16", "2026-09-30", "2026-10-01"],
      ["2026-10-01", "2026-10-15", "2026-10-16"],
    ] as const;
    let cutoffIndex = 0;
    const newRun = async (label: string) => {
      const [periodStart, periodEnd, payDate] = cutoffs[cutoffIndex++]!;
      const [run] = await db.insert(payrollRuns).values({
        organizationId: org.id, periodLabel: label,
        periodStart, periodEnd,
        payDate, status: "Released",
        employeeCount: 1, grossPay: "20000.00", netPay: "15000.00",
      }).returning();
      await db.insert(payrollEntries).values({
        payrollRunId: run.id, employeeId: worker.id,
        grossPay: "20000.00", deductions: "5000.00", netPay: "15000.00",
        trace: { payment: { employeeName: "Fictional Worker", employeeNo: worker.employeeNo,
          bankAccount: worker.bankAccount, bankCode: worker.bankCode, mobile: null } },
      });
      return run;
    };
    const providerFirst = await newRun("Provider wins first");
    const bankFirst = await newRun("Bank file wins first");
    const walletParallel = await newRun("Different payroll shares wallet");
    const underfunded = await newRun("Balance insufficient after preflight");
    const uncertain = await newRun("Provider acknowledgement lost");
    const retryCandidate = await newRun("Failed transfer retry timeout");
    const crossRail = await newRun("Unknown PayMongo versus Xendit");
    Object.assign(process.env, {
      PAYMONGO_SECRET_KEY: "sk_test_synthetic_http_only",
      PAYMONGO_WALLET_ID: "wallet_synthetic",
      PAYMONGO_WEBHOOK_SECRET: "whsec_synthetic_never_live",
      PAYMONGO_DISBURSEMENTS_ENABLED: "true",
      PAYROLL_PAYOUT_PROVIDER: "paymongo",
      APP_BASE_URL: "http://127.0.0.1:3000",
    });

    patch("../src/lib/auth", { getSessionUser: async () => operator });
    patch("../src/lib/security-request", {
      requireSensitiveActionMfa: () => null,
      enforceSensitiveActionRateLimit: async () => null,
    });
    patch("../src/lib/multi-entity-run-guard", { requireRunEmployer: async () => null });
    patch("../src/lib/treasury-controls", {
      authorizeTreasuryOperation: async () => ({ response: null, evidence: null }),
    });
    patch("../src/lib/payout-destination-controls", {
      latestApprovedPayoutDestinationChangeForRun: async () => null,
    });

    let bankBlockedRun = 0;
    let bankGenerationStarted: (() => void) | null = null;
    let completeBankGeneration: Promise<void> | null = null;
    let bankGenerations = 0;
    patch("../src/lib/exporters", {
      generateBankFile: async (id: number) => {
        bankGenerations += 1;
        if (id === bankBlockedRun) {
          bankGenerationStarted?.();
          await completeBankGeneration;
        }
        return {
          body: "SYNTHETIC FILE - NEVER UPLOAD", filename: "fictional-bank.csv",
          contentType: "text/csv",
        };
      },
    });

    let providerStarted: (() => void) | null = null;
    let providerGate: Promise<void> | null = null;
    let blockedProviderRun = 0;
    let walletBalanceCents = 200000000;
    let providerPostCount = 0;
    let retryProviderStarted: (() => void) | null = null;
    let retryProviderGate: Promise<void> | null = null;
    const postKeys: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.startsWith("https://api.paymongo.com/v2/transfers/receiving_institutions?")) {
        return Response.json({ data: [{ attributes: { name: "BDO Unibank", bic: "BNORPHMM" } }] });
      }
      if (url === "https://api.paymongo.com/v2/wallets/wallet_synthetic") {
        return Response.json({ data: {
          id: "wallet_synthetic", attributes: { status: "active",
            balance: { available: walletBalanceCents, pending: 0 },
            account: { account_number: "0000000001", account_name: "Fictional Wallet" } },
        } });
      }
      if (url === "https://api.paymongo.com/v2/batch_transfers/batch_tr_synthetic_failed") {
        return Response.json({ data: {
          id: "batch_tr_synthetic_failed",
          transfers: [{
            id: "tr_failed_synthetic",
            reference_number: "PAY-" + retryCandidate.id + "-" + worker.employeeNo,
            status: "failed", amount: 1500000, provider: "instapay",
          }],
        } });
      }
      if (url === "https://api.paymongo.com/v2/batch_transfers" && init?.method === "POST") {
        providerPostCount += 1;
        const idempotencyKey = new Headers(init.headers).get("Idempotency-Key") ?? "";
        postKeys.push(idempotencyKey);
        if (idempotencyKey === "payroll-run-" + blockedProviderRun) {
          providerStarted?.();
          await providerGate;
        }
        if (idempotencyKey === "payroll-run-" + uncertain.id) {
          throw new Error("Synthetic network timeout after possible PayMongo acceptance");
        }
        if (idempotencyKey.startsWith("payroll-run-" + retryCandidate.id + "-retry-")) {
          retryProviderStarted?.();
          await retryProviderGate;
          throw new Error("Synthetic failed-transfer retry timeout after possible acceptance");
        }
        return Response.json({ data: { id: "batch_synthetic_" + providerPostCount,
          transfers: [{ id: "transfer_synthetic_" + providerPostCount,
            reference_number: "PAY-FAKE", status: "pending", amount: 1500000 }] } });
      }
      throw new Error("UNMOCKED_EXTERNAL_NETWORK_DENIED: " + url);
    };

    const { GET, POST } = await import("../src/app/api/payroll-runs/[id]/exports/route");
    const getBank = (id: number) => GET(
      new Request("http://127.0.0.1:3000/api/payroll-runs/" + id
        + "/exports?kind=bank&template=BDO%20DAT&dryRun=false"),
      { params: Promise.resolve({ id: String(id) }) },
    );
    const post = (id: number, body: object) => POST(
      new Request("http://127.0.0.1:3000/api/payroll-runs/" + id + "/exports", {
        method: "POST", headers: {
          origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin",
          "content-type": "application/json",
        }, body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: String(id) }) },
    );
    const preflight = async (id: number) => {
      const response = await post(id, { mode: "preflight" });
      assert.equal(response.status, 200,
        "PayMongo preflight must reach the synthetic wallet and bank fixture");
      const result = await response.json();
      assert.equal(result.ready, true);
    };
    await preflight(providerFirst.id);
    await preflight(bankFirst.id);
    await preflight(walletParallel.id);
    await preflight(underfunded.id);
    await preflight(uncertain.id);
    await preflight(retryCandidate.id);

    // Provider wins. Hold the real PayMongo HTTP POST while GET attempts to
    // acquire the same per-run advisory lock; no final file may be generated.
    blockedProviderRun = providerFirst.id;
    let markProviderStarted!: () => void;
    const providerReached = new Promise<void>((resolve) => { markProviderStarted = resolve; });
    providerStarted = markProviderStarted;
    let releaseProvider!: () => void;
    providerGate = new Promise<void>((resolve) => { releaseProvider = resolve; });
    const firstSubmission = post(providerFirst.id, { confirm: true });
    await providerReached;
    try {
      assert.equal((await post(providerFirst.id, { confirm: true })).status, 409,
        "two concurrent POSTs for the same payroll must have exactly one winner");
      assert.equal((await post(walletParallel.id, { confirm: true })).status, 502,
        "another payroll cannot concurrently spend from the same PayMongo wallet");
      const blockedBank = await getBank(providerFirst.id);
      assert.equal(blockedBank.status, 409, "a bank file may not race a provider submit");
      assert.equal(bankGenerations, 0);
      const pending = await db.select().from(auditEvents)
        .where(eq(auditEvents.organizationId, org.id));
      assert.equal(pending.filter((event) =>
        event.action === "Payroll payout submission initiated via PayMongo"
        && Number((event.metadata as Record<string, unknown>).runId) === walletParallel.id
      ).length, 0, "losing the wallet lock never creates a false provider intent");
    } finally {
      releaseProvider();
    }
    assert.equal((await firstSubmission).status, 200);
    assert.equal(providerPostCount, 1);
    assert.equal((await post(walletParallel.id, { confirm: true })).status, 200,
      "a denied wallet contender may submit after the first sender completes");
    assert.equal(providerPostCount, 2);
    // Two distinct payroll runs have legitimately submitted one batch each.
    // A retry of the first run must not issue a third provider POST.
    const postCountBeforeRetry = providerPostCount;
    const providerRetry = await post(providerFirst.id, { confirm: true });
    assert.equal(providerRetry.status, 409, "a completed HTTP request must not send salaries twice");
    assert.equal((await getBank(providerFirst.id)).status, 409);
    assert.equal(providerPostCount, postCountBeforeRetry,
      "retries and fallback bank GET must not contact PayMongo again");

    // Bank wins. Hold real GET after the payout run lock is acquired while a
    // PayMongo POST tries to claim it. The GET writes its final audit receipt
    // before the lock is released.
    bankBlockedRun = bankFirst.id;
    let markBankStarted!: () => void;
    const bankReached = new Promise<void>((resolve) => { markBankStarted = resolve; });
    bankGenerationStarted = markBankStarted;
    let releaseBank!: () => void;
    completeBankGeneration = new Promise<void>((resolve) => { releaseBank = resolve; });
    const firstBank = getBank(bankFirst.id);
    await bankReached;
    try {
      assert.equal((await post(bankFirst.id, { confirm: true })).status, 409);
      assert.equal(providerPostCount, 2, "bank-first overlap cannot contact PayMongo");
    } finally {
      releaseBank();
    }
    assert.equal((await firstBank).status, 200);
    assert.equal((await post(bankFirst.id, { confirm: true })).status, 409);
    assert.equal(providerPostCount, 2);
    assert.equal((await getBank(bankFirst.id)).status, 409, "final bank file is one-time");

    // Wallet drops below the amount that passed preflight. There is no
    // outbound HTTP and no ambiguous intent; the operator may fund and retry.
    walletBalanceCents = 1;
    assert.equal((await post(underfunded.id, { confirm: true })).status, 502);
    assert.equal(providerPostCount, 2);
    const afterFundingFailure = await db.select().from(auditEvents)
      .where(eq(auditEvents.organizationId, org.id));
    assert.equal(afterFundingFailure.filter((event) =>
      event.action === "Payroll payout submission initiated via PayMongo"
      && Number((event.metadata as Record<string, unknown>).runId) === underfunded.id
    ).length, 0, "funding failure cannot be mistaken for a sent transfer");
    walletBalanceCents = 200000000;
    assert.equal((await post(underfunded.id, { confirm: true })).status, 200);
    assert.equal(providerPostCount, 3);

    // Unknown provider acknowledgement: a recorded pre-POST submission intent
    // survives the HTTP 502 and blocks both retry and fallback bank generation.
    const timedOut = await post(uncertain.id, { confirm: true });
    assert.equal(timedOut.status, 502);
    assert.equal(providerPostCount, 4);
    assert.equal((await post(uncertain.id, { confirm: true })).status, 409);
    assert.equal((await getBank(uncertain.id)).status, 409);
    assert.equal(providerPostCount, 4);
    assert.deepEqual(postKeys, [
      "payroll-run-" + providerFirst.id, "payroll-run-" + walletParallel.id,
      "payroll-run-" + underfunded.id, "payroll-run-" + uncertain.id,
    ]);
    const events = await db.select().from(auditEvents).where(eq(auditEvents.organizationId, org.id));
    const count = (id: number, action: string) => events.filter((event) =>
      event.action === action && Number(
        (event.metadata as Record<string, unknown> | null)?.runId,
      ) === id).length;
    assert.equal(count(providerFirst.id, "Payroll payout submission initiated via PayMongo"), 1);
    assert.equal(count(walletParallel.id, "Payroll payout submission initiated via PayMongo"), 1);
    assert.equal(count(underfunded.id, "Payroll payout submission initiated via PayMongo"), 1);
    assert.equal(count(uncertain.id, "Payroll payout submission initiated via PayMongo"), 1);
    assert.equal(count(bankFirst.id, "bank export generated"), 1);
    assert.equal(count(bankFirst.id, "Payroll payout submission initiated via PayMongo"), 0);

    // The retry HTTP endpoint uses the real PostgreSQL per-run AND wallet
    // advisory locks, genuine durable audit storage, and stubbed provider HTTP.
    // An ambiguous retry must never become a second provider request.
    await db.insert(auditEvents).values({
      organizationId: org.id, actor: operator.name,
      action: "Payroll payout submitted via PayMongo",
      resource: retryCandidate.periodLabel,
      metadata: {
        runId: retryCandidate.id, batchId: "batch_tr_synthetic_failed",
        provider: "instapay", transferCount: 1,
        transfers: [{ id: "tr_failed_synthetic",
          referenceNumber: "PAY-" + retryCandidate.id + "-" + worker.employeeNo,
          status: "failed", amountCents: 1500000 }],
      },
    });
    const { POST: retryPOST } = await import("../src/app/api/payroll-runs/[id]/payout-reconciliation/route");
    const retryFailed = (id: number) => retryPOST(
      new Request("http://127.0.0.1:3000/api/payroll-runs/" + id + "/payout-reconciliation", {
        method: "POST",
        headers: { origin: "http://127.0.0.1:3000",
          "sec-fetch-site": "same-origin", "content-type": "application/json" },
        body: JSON.stringify({ action: "retry-failed", confirm: true }),
      }),
      { params: Promise.resolve({ id: String(id) }) },
    );
    let markRetryProviderStarted!: () => void;
    const retryReached = new Promise<void>((resolve) => { markRetryProviderStarted = resolve; });
    retryProviderStarted = markRetryProviderStarted;
    let releaseRetryProvider!: () => void;
    retryProviderGate = new Promise<void>((resolve) => { releaseRetryProvider = resolve; });
    const beforeRetryPosts = providerPostCount;
    const firstRetry = retryFailed(retryCandidate.id);
    await retryReached;
    try {
      const intentEvents = await db.select().from(auditEvents)
        .where(eq(auditEvents.organizationId, org.id));
      assert.equal(intentEvents.filter((event) =>
        event.action === "Payroll payout retry submission initiated via PayMongo"
        && Number((event.metadata as Record<string, unknown>).runId) === retryCandidate.id
      ).length, 1, "the retry intent must commit before provider HTTP");
      assert.equal((await retryFailed(retryCandidate.id)).status, 409,
        "two failed-transfer retries cannot contact PayMongo concurrently");
      const bankBefore = bankGenerations;
      assert.equal((await getBank(retryCandidate.id)).status, 409);
      assert.equal(bankGenerations, bankBefore, "no bank file during ambiguous retry");
      assert.equal(providerPostCount, beforeRetryPosts + 1);
    } finally {
      releaseRetryProvider();
    }
    assert.equal((await firstRetry).status, 502,
      "the simulated provider timeout has an UNKNOWN outcome");
    assert.equal((await retryFailed(retryCandidate.id)).status, 409,
      "a lost retry acknowledgement cannot permit another provider POST");
    assert.equal(providerPostCount, beforeRetryPosts + 1);
    const afterRetry = await db.select().from(auditEvents)
      .where(eq(auditEvents.organizationId, org.id));
    const unknownRetryAudit = afterRetry.find((event) =>
      event.action === "Payroll payout retry outcome unknown"
      && Number((event.metadata as Record<string, unknown>).runId) === retryCandidate.id
    );
    assert.ok(unknownRetryAudit, "an ambiguous retry needs a durable unknown-outcome receipt");
    const unknownMeta = unknownRetryAudit.metadata as Record<string, unknown>;
    assert.equal(unknownMeta.providerOutcomeUnknown, true);
    assert.equal(unknownMeta.moneyMovedByLinaw, null,
      "a provider timeout does not prove that money did not move");
    const { derivePayrollPayoutState } = await import("../src/lib/payroll-payout-state");
    const view = derivePayrollPayoutState(afterRetry, retryCandidate.id);
    assert.equal(view.reconciliation.status, "attention");
    assert.equal(view.reconciliation.canRetryFailed, false);
    assert.match(view.payout.label, /failed-transfer retry may have moved salaries/);

    // A durable PayMongo initiation ALONE (with no batch ID) must prohibit
    // staging Xendit and issuing the final bank file for this same payroll.
    await db.insert(auditEvents).values({
      organizationId: org.id, actor: operator.name,
      action: "Payroll payout submission initiated via PayMongo",
      resource: crossRail.periodLabel,
      metadata: {
        runId: crossRail.id, provider: "PayMongo",
        idempotencyKey: "payroll-run-" + crossRail.id,
        providerOutcomeVerified: false,
      },
    });
    const { preflightXenditPayroll, submitXenditPayroll } =
      await import("../src/lib/xendit-payroll-operations");
    await assert.rejects(
      () => preflightXenditPayroll(crossRail, operator.name),
      /XENDIT_PREVIOUS_PAYOUT_OR_BANK_FILE_UNCERTAIN/,
    );
    await assert.rejects(
      () => submitXenditPayroll(crossRail, operator.name),
      /XENDIT_PREVIOUS_PAYOUT_OR_BANK_FILE_UNCERTAIN/,
    );
    const [crossEntry] = await db.select({ id: payrollEntries.id })
      .from(payrollEntries).where(eq(payrollEntries.payrollRunId, crossRail.id));
    const { prepareInitialPayoutBatch } = await import("../src/lib/payout-ledger");
    await assert.rejects(
      () => prepareInitialPayoutBatch({
        organizationId: org.id, payrollRunId: crossRail.id, provider: "xendit",
        intents: [{ employeeId: worker.id, payrollEntryId: crossEntry.id,
          referenceNumber: "PAY-" + crossRail.id + "-" + worker.employeeNo,
          amountCents: 1500000 }],
      }),
      /PAYOUT_EXISTING_LEGACY_PAYMENT_REQUIRES_RECONCILIATION/,
    );
    assert.equal((await getBank(crossRail.id)).status, 409);
    assert.equal(providerPostCount, beforeRetryPosts + 1);
  } finally {
    globalThis.fetch = previousFetch;
    for (const restore of restores.reverse()) restore();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await db.delete(organizations).where(eq(organizations.id, org.id));
    await db.delete(users).where(inArray(users.id, [operator.id]));
  }
});
