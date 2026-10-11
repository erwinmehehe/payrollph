import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/db";
import { organizations, legalEntities, employees, payrollEntries, payrollRuns } from "../src/db/schema";
import {
  preflightXenditPayroll, submitXenditPayroll, reconcileXenditPayroll,
  resolveUnknownXenditPayroll,
} from "../src/lib/xendit-payroll-operations";
import { xenditPayoutLedger } from "../src/lib/xendit-payout-ledger";

const payoutId = "po-b2c3d4e5-f6a7-8901-bcde-f23456789012";

async function fixture() {
  const [org] = await db.insert(organizations).values({
    name: "Xendit Synthetic Payroll",
    legalName: "Xendit Synthetic Payroll Inc.",
  }).returning();
  const [entity] = await db.insert(legalEntities).values({
    organizationId: org.id, code: "XENDIT", displayName: "Xendit CI Employer",
    legalName: "Xendit CI Employer Inc.", primaryEntity: true,
  }).returning();
  const [employee] = await db.insert(employees).values({
    organizationId: org.id, legalEntityId: entity.id,
    employeeNo: "E001", firstName: "Maria", lastName: "Santos",
    title: "Payroll Assistant", avatarInitials: "MS",
    basicRate: "35000.00", bankAccount: "1234567890",
    bankCode: "BDO", startDate: "2026-01-01",
  }).returning();
  const [run] = await db.insert(payrollRuns).values({
    organizationId: org.id, legalEntityId: entity.id,
    periodLabel: "Xendit Synthetic Cutoff",
    periodStart: "2026-10-01", periodEnd: "2026-10-15",
    payDate: "2026-10-16", status: "Released",
    employeeCount: 1, grossPay: "20000.00", netPay: "15501.23",
  }).returning();
  await db.insert(payrollEntries).values({
    payrollRunId: run.id, employeeId: employee.id,
    grossPay: "20000.00", deductions: "4498.77", netPay: "15501.23",
    trace: { payment: {
      employeeName: "Maria Santos", employeeNo: employee.employeeNo,
      bankAccount: employee.bankAccount, bankCode: employee.bankCode,
      mobile: employee.mobile,
    } },
  });
  const prior = Object.fromEntries([
    "NODE_ENV", "APP_BASE_URL", "XENDIT_PAYOUT_SECRET_KEY",
    "XENDIT_PAYOUT_CALLBACK_TOKEN", "XENDIT_PAYOUT_BUSINESS_ID",
    "XENDIT_PAYOUT_ALLOWED_ORGANIZATION_ID",
    "XENDIT_PAYOUT_ALLOWED_LEGAL_ENTITY_ID",
    "XENDIT_PAYOUTS_ENABLED", "XENDIT_PAYOUTS_LIVE_APPROVED",
    "PAYROLL_PAYOUT_PROVIDER",
  ].map((key) => [key, process.env[key]]));
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
    restore() {
      for (const [key, value] of Object.entries(prior)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}

function providerPayload(runId: number, businessId: string, status: string) {
  return {
    payout_id: payoutId,
    reference_id: `PAY-${runId}-E001`,
    status, source_currency: "PHP", source_amount: 1550123,
    destination_currency: "PHP", business_id: businessId,
  };
}

test("Xendit stages, sends, and reconciles exactly one immutable employee payout", async () => {
  const f = await fixture();
  const originalFetch = globalThis.fetch;
  let sends = 0;
  try {
    globalThis.fetch = async (url, init) => {
      const uri = String(url);
      if (uri === "https://api.xendit.co/v3/payouts" && init?.method === "POST") {
        sends += 1;
        const body = JSON.parse(String(init.body)) as { payout_details: { source_amount: number } };
        assert.equal(body.payout_details.source_amount, 1550123);
        return Response.json(providerPayload(f.run.id, f.businessId, "ACCEPTED"));
      }
      if (uri === `https://api.xendit.co/v3/payouts/${payoutId}`) {
        return Response.json(providerPayload(f.run.id, f.businessId, "SUCCEEDED"));
      }
      throw new Error("No unmocked external payments allowed in integration tests.");
    };
    const check = await preflightXenditPayroll(f.run, "CI synthetic operator");
    assert.equal(check.ready, true);
    assert.equal(check.moneyMoved, false);
    assert.equal(check.totalAmountCents, 1550123);

    const sent = await submitXenditPayroll(f.run, "CI synthetic operator");
    assert.deepEqual(sent.submitted, [`PAY-${f.run.id}-E001`]);
    assert.equal(sends, 1);
    assert.equal(sent.ledger?.counts.submitted, 1);

    const reconciled = await reconcileXenditPayroll(f.run, "CI synthetic checker");
    assert.equal(reconciled.checked, 1);
    assert.equal(reconciled.ledger?.counts.succeeded, 1);
    assert.equal(reconciled.ledger?.status, "settled");
    assert.equal((await xenditPayoutLedger(f.org.id, f.run.id))?.rows[0]?.providerPayoutId, payoutId);
    const again = await submitXenditPayroll(f.run, "CI synthetic operator");
    assert.equal(again.submitted.length, 0);
    assert.equal(sends, 1, "A second request must never send salary again.");
  } finally {
    globalThis.fetch = originalFetch;
    f.restore();
  }
});

test("Xendit transport timeout leaves a durable uncertain outcome; lookup cannot initiate a second payout", async () => {
  const f = await fixture();
  const originalFetch = globalThis.fetch;
  let sends = 0;
  try {
    globalThis.fetch = async (url, init) => {
      const uri = String(url);
      if (uri === "https://api.xendit.co/v3/payouts" && init?.method === "POST") {
        sends += 1;
        throw new Error("Synthetic request timeout after bank may have received instruction");
      }
      if (uri === `https://api.xendit.co/v3/payouts/${payoutId}`) {
        return Response.json(providerPayload(f.run.id, f.businessId, "ACCEPTED"));
      }
      throw new Error("Unexpected real payment request");
    };
    assert.equal((await preflightXenditPayroll(f.run, "CI synthetic operator")).ready, true);
    await assert.rejects(submitXenditPayroll(f.run, "CI synthetic operator"), /uncertain/);
    assert.equal(sends, 1);
    assert.equal((await xenditPayoutLedger(f.org.id, f.run.id))?.counts.unknown, 1);
    await assert.rejects(submitXenditPayroll(f.run, "CI synthetic operator"), /XENDIT_BATCH_NOT_PREPARED/);
    assert.equal(sends, 1, "Unknown transport outcome cannot be sent again");
    const linked = await resolveUnknownXenditPayroll({
      run: f.run, actor: "CI synthetic checker",
      referenceNumber: `PAY-${f.run.id}-E001`, payoutId,
    });
    assert.equal(linked?.counts.unknown, 0);
    assert.equal(linked?.counts.submitted, 1);
    assert.equal(sends, 1);
  } finally {
    globalThis.fetch = originalFetch;
    f.restore();
  }
});
