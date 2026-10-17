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
    const newRun = async (label: string) => {
      const [run] = await db.insert(payrollRuns).values({
        organizationId: org.id, periodLabel: label,
        periodStart: "2026-10-01", periodEnd: "2026-10-15",
        payDate: "2026-10-16", status: "Released",
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
    const uncertain = await newRun("Provider acknowledgement lost");
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
    let providerPostCount = 0;
    const postKeys: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.startsWith("https://api.paymongo.com/v2/transfers/receiving_institutions?")) {
        return Response.json({ data: [{ attributes: { name: "BDO Unibank", bic: "BNORPHMM" } }] });
      }
      if (url === "https://api.paymongo.com/v2/wallets/wallet_synthetic") {
        return Response.json({ data: {
          id: "wallet_synthetic", attributes: { status: "active",
            balance: { available: 200000000, pending: 0 },
            account: { account_number: "0000000001", account_name: "Fictional Wallet" } },
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
    await preflight(uncertain.id);

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
      const blockedBank = await getBank(providerFirst.id);
      assert.equal(blockedBank.status, 409, "a bank file may not race a provider submit");
      assert.equal(bankGenerations, 0);
    } finally {
      releaseProvider();
    }
    assert.equal((await firstSubmission).status, 200);
    assert.equal(providerPostCount, 1);
    const providerRetry = await post(providerFirst.id, { confirm: true });
    assert.equal(providerRetry.status, 409, "a completed HTTP request must not send salaries twice");
    assert.equal((await getBank(providerFirst.id)).status, 409);
    assert.equal(providerPostCount, 1);

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
      assert.equal(providerPostCount, 1, "bank-first overlap cannot contact PayMongo");
    } finally {
      releaseBank();
    }
    assert.equal((await firstBank).status, 200);
    assert.equal((await post(bankFirst.id, { confirm: true })).status, 409);
    assert.equal(providerPostCount, 1);
    assert.equal((await getBank(bankFirst.id)).status, 409, "final bank file is one-time");

    // Unknown provider acknowledgement: a recorded pre-POST submission intent
    // survives the HTTP 502 and blocks both retry and fallback bank generation.
    const timedOut = await post(uncertain.id, { confirm: true });
    assert.equal(timedOut.status, 502);
    assert.equal(providerPostCount, 2);
    assert.equal((await post(uncertain.id, { confirm: true })).status, 409);
    assert.equal((await getBank(uncertain.id)).status, 409);
    assert.equal(providerPostCount, 2);
    assert.deepEqual(postKeys, [
      "payroll-run-" + providerFirst.id, "payroll-run-" + uncertain.id,
    ]);
    const events = await db.select().from(auditEvents).where(eq(auditEvents.organizationId, org.id));
    const count = (id: number, action: string) => events.filter((event) =>
      event.action === action && Number(
        (event.metadata as Record<string, unknown> | null)?.runId,
      ) === id).length;
    assert.equal(count(providerFirst.id, "Payroll payout submission initiated via PayMongo"), 1);
    assert.equal(count(uncertain.id, "Payroll payout submission initiated via PayMongo"), 1);
    assert.equal(count(bankFirst.id, "bank export generated"), 1);
    assert.equal(count(bankFirst.id, "Payroll payout submission initiated via PayMongo"), 0);
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
