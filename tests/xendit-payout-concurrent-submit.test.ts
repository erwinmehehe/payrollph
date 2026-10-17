import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/db";
import { eq, inArray } from "drizzle-orm";
import { auditEvents, employees, legalEntities, organizations, payrollEntries, payrollRuns } from "../src/db/schema";
import { preflightXenditPayroll, submitXenditPayroll } from "../src/lib/xendit-payroll-operations";
import { xenditPayoutLedger } from "../src/lib/xendit-payout-ledger";

// Concurrency properties of the money-moving path. The provider is a local stub
// with an artificial delay so that overlapping submits really interleave.

const ENV_KEYS = [
  "NODE_ENV", "APP_BASE_URL", "XENDIT_PAYOUT_SECRET_KEY", "XENDIT_PAYOUT_CALLBACK_TOKEN",
  "XENDIT_PAYOUT_BUSINESS_ID", "XENDIT_PAYOUT_ALLOWED_ORGANIZATION_ID", "XENDIT_PAYOUT_ALLOWED_LEGAL_ENTITY_ID",
  "XENDIT_PAYOUTS_ENABLED", "XENDIT_PAYOUTS_LIVE_APPROVED", "PAYROLL_PAYOUT_PROVIDER",
] as const;

async function fixture(employeeCount: number) {
  const [org] = await db.insert(organizations).values({
    name: "Xendit Concurrent Synthetic", legalName: "Xendit Concurrent Synthetic Inc.",
  }).returning();
  const [entity] = await db.insert(legalEntities).values({
    organizationId: org.id, code: "XCONC", displayName: "Concurrent CI Employer",
    legalName: "Concurrent CI Employer Inc.", primaryEntity: true,
  }).returning();
  const [run] = await db.insert(payrollRuns).values({
    organizationId: org.id, legalEntityId: entity.id, periodLabel: "Xendit Concurrent Cutoff",
    periodStart: "2026-10-01", periodEnd: "2026-10-15", payDate: "2026-10-16", status: "Released",
    employeeCount, grossPay: String(20000 * employeeCount) + ".00", netPay: String(15000 * employeeCount) + ".00",
  }).returning();
  for (let i = 1; i <= employeeCount; i++) {
    const no = "E" + String(i).padStart(3, "0");
    const [employee] = await db.insert(employees).values({
      organizationId: org.id, legalEntityId: entity.id, employeeNo: no, firstName: "Synthetic" + i,
      lastName: "Payee", title: "Payroll Assistant", avatarInitials: "SP", basicRate: "35000.00",
      bankAccount: "12345678" + String(i).padStart(2, "0"), bankCode: "BDO", startDate: "2026-01-01",
    }).returning();
    await db.insert(payrollEntries).values({
      payrollRunId: run.id, employeeId: employee.id, grossPay: "20000.00", deductions: "5000.00", netPay: "15000.00",
      trace: { payment: {
        employeeName: "Synthetic" + i + " Payee", employeeNo: no, bankAccount: employee.bankAccount,
        bankCode: employee.bankCode, mobile: employee.mobile,
      } },
    });
  }
  const prior = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    APP_BASE_URL: "https://example-payroll.test",
    XENDIT_PAYOUT_SECRET_KEY: "xnd_development_synthetic_test_not_live",
    XENDIT_PAYOUT_CALLBACK_TOKEN: "synthetic-webhook-token-is-long",
    XENDIT_PAYOUT_BUSINESS_ID: `biz_ci_${org.id}`,
    XENDIT_PAYOUT_ALLOWED_ORGANIZATION_ID: String(org.id),
    XENDIT_PAYOUT_ALLOWED_LEGAL_ENTITY_ID: String(entity.id),
    XENDIT_PAYOUTS_ENABLED: "true",
    XENDIT_PAYOUTS_LIVE_APPROVED: "true",
    PAYROLL_PAYOUT_PROVIDER: "xendit",
  });
  return {
    run, org, businessId: `biz_ci_${org.id}`,
    async cleanup() {
      for (const [key, value] of Object.entries(prior)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    },
  };
}

test("concurrent submits for one run send each salary at most once", async () => {
  const f = await fixture(3);
  const originalFetch = globalThis.fetch;
  const sends = new Map<string, number>();
  try {
    globalThis.fetch = async (url, init) => {
      if (String(url) === "https://api.xendit.co/v3/payouts" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { reference_id: string; payout_details: { source_amount: number } };
        sends.set(body.reference_id, (sends.get(body.reference_id) ?? 0) + 1);
        // Wide window so overlapping submits interleave with this in-flight send.
        await new Promise((resolve) => setTimeout(resolve, 120));
        const n = body.reference_id.split("-").pop()!.replace(/\D/g, "");
        return Response.json({
          payout_id: `po-${String(f.run.id).padStart(8, "0")}-0000-4000-8000-00000000000${n}`,
          reference_id: body.reference_id, status: "ACCEPTED", source_currency: "PHP",
          source_amount: body.payout_details.source_amount, destination_currency: "PHP", business_id: f.businessId,
        });
      }
      throw new Error("No unmocked external payments allowed in integration tests.");
    };
    assert.equal((await preflightXenditPayroll(f.run, "CI synthetic operator")).ready, true);

    const outcomes = await Promise.allSettled(
      [0, 1, 2, 3].map(() => submitXenditPayroll(f.run, "CI synthetic operator")),
    );
    // Callers that lose the claim may fail, but no salary may ever be sent twice.
    for (const [reference, count] of sends) assert.equal(count, 1, `${reference} was sent ${count} times`);
    const sentTotal = [...sends.values()].reduce((a, b) => a + b, 0);
    assert.ok(sentTotal <= 3, `at most one send per payee, got ${sentTotal}`);

    // A follow-up submit must finish the remaining payees without resending anyone.
    for (let attempt = 0; attempt < 4 && sentTotal < 3; attempt++) {
      await submitXenditPayroll(f.run, "CI synthetic operator").catch(() => undefined);
    }
    for (const [reference, count] of sends) assert.equal(count, 1, `${reference} was sent ${count} times after retries`);

    const ledger = await xenditPayoutLedger(f.org.id, f.run.id);
    const stuck = ledger?.rows.filter((row) => row.status === "submitting") ?? [];
    assert.ok(outcomes.some((o) => o.status === "fulfilled"), "at least one concurrent submit succeeds");
    assert.deepEqual(stuck, [], "no transfer is left claimed-but-unsent after the callers finish");
  } finally {
    globalThis.fetch = originalFetch;
    await f.cleanup();
  }
});
