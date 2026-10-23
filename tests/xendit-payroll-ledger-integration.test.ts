import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/db";
import { eq } from "drizzle-orm";
import { auditEvents, organizations, legalEntities, employees, payrollEntries, payrollRuns } from "../src/db/schema";
import {
  preflightXenditPayroll, submitXenditPayroll, reconcileXenditPayroll,
  resolveUnknownXenditPayroll,
} from "../src/lib/xendit-payroll-operations";
import { xenditPayoutLedger } from "../src/lib/xendit-payout-ledger";

const payoutIdForRun = (runId: number) => `po-${String(runId).padStart(8, "0")}-0000-4000-8000-000000000001`;

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
    payout_id: payoutIdForRun(runId),
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
      if (uri === `https://api.xendit.co/v3/payouts/${payoutIdForRun(f.run.id)}`) {
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
    assert.equal((await xenditPayoutLedger(f.org.id, f.run.id))?.rows[0]?.providerPayoutId, payoutIdForRun(f.run.id));
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
      if (uri === `https://api.xendit.co/v3/payouts/${payoutIdForRun(f.run.id)}`) {
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
      referenceNumber: `PAY-${f.run.id}-E001`, payoutId: payoutIdForRun(f.run.id),
    });
    assert.equal(linked?.counts.unknown, 0);
    assert.equal(linked?.counts.submitted, 1);
    assert.equal(sends, 1);
  } finally {
    globalThis.fetch = originalFetch;
    f.restore();
  }
});

test("mismatched provider lookup cannot link or settle an unknown payout; exact-ID recovery remains read-only", async () => {
  const f = await fixture();
  const originalFetch = globalThis.fetch;
  const priorFlag = process.env.XENDIT_RECONCILIATION_IDENTITY_ENABLED;
  process.env.XENDIT_RECONCILIATION_IDENTITY_ENABLED = "true";
  let sends = 0;
  let reads = 0;
  let mismatch = true;
  try {
    globalThis.fetch = async (url, init) => {
      if (String(url) === "https://api.xendit.co/v3/payouts" && init?.method === "POST") {
        sends++;
        throw new Error("Synthetic uncertain send; no external provider contacted");
      }
      assert.equal(String(url), "https://api.xendit.co/v3/payouts/" + payoutIdForRun(f.run.id));
      assert.equal(new Request(String(url), init).method, "GET");
      reads++;
      return Response.json({ ...providerPayload(f.run.id, f.businessId, "SUCCEEDED"),
        payout_id: mismatch ? "po-unrelated-synthetic-0001" : payoutIdForRun(f.run.id) });
    };
    assert.equal((await preflightXenditPayroll(f.run, "Synthetic operator")).ready, true);
    await assert.rejects(submitXenditPayroll(f.run, "Synthetic operator"), /uncertain/);
    const before = await xenditPayoutLedger(f.org.id, f.run.id);
    assert.equal(before?.counts.unknown, 1);
    const input = { run: f.run, actor: "Independent synthetic checker",
      referenceNumber: `PAY-${f.run.id}-E001`, payoutId: payoutIdForRun(f.run.id) };
    for (let i = 0; i < 2; i++) {
      await assert.rejects(resolveUnknownXenditPayroll(input), /XENDIT_RECONCILIATION_PAYOUT_ID_MISMATCH/);
      assert.deepEqual(await xenditPayoutLedger(f.org.id, f.run.id), before,
        "Wrong-ID lookup/retry cannot change ledger identity, amount or settlement");
    }
    const evidence = await db.select().from(auditEvents).where(eq(auditEvents.organizationId, f.org.id));
    assert.equal(evidence.filter(row => row.action === "Xendit payout read-only lookup failed").length, 2);
    assert.equal(evidence.filter(row => row.action === "Xendit unknown payout linked after provider read-only verification").length, 0);
    mismatch = false;
    const settled = await resolveUnknownXenditPayroll(input);
    assert.equal(settled?.counts.succeeded, 1);
    assert.equal(settled?.rows[0].providerPayoutId, payoutIdForRun(f.run.id));
    assert.equal(reads, 3);
    assert.equal(sends, 1, "All reconciliation attempts must be GET-only");
  } finally {
    globalThis.fetch = originalFetch;
    if (priorFlag === undefined) delete process.env.XENDIT_RECONCILIATION_IDENTITY_ENABLED;
    else process.env.XENDIT_RECONCILIATION_IDENTITY_ENABLED = priorFlag;
    f.restore();
  }
});

test("Xendit reconciliation advances across multiple provider pages without double-paying anyone", async () => {
  const f = await fixture();
  const previousFetch = globalThis.fetch;
  let sends = 0;
  const byPayoutId = new Map<string, string>();
  try {
    for (let number = 2; number <= 12; number += 1) {
      const employeeNo = `E${String(number).padStart(3, "0")}`;
      const firstName = `Person${number}`;
      const [employee] = await db.insert(employees).values({
        organizationId: f.org.id, legalEntityId: f.run.legalEntityId,
        employeeNo, firstName, lastName: "Payroll", title: "Staff",
        avatarInitials: "PP", basicRate: "35000.00",
        bankAccount: `123456${String(number).padStart(4, "0")}`,
        bankCode: "BDO", startDate: "2026-01-01",
      }).returning();
      await db.insert(payrollEntries).values({
        payrollRunId: f.run.id, employeeId: employee.id,
        grossPay: "20000.00", deductions: "4498.77", netPay: "15501.23",
        trace: { payment: {
          employeeName: `${firstName} Payroll`, employeeNo,
          bankAccount: employee.bankAccount, bankCode: employee.bankCode,
          mobile: employee.mobile,
        } },
      });
    }
    const [run] = await db.update(payrollRuns).set({
      employeeCount: 12, grossPay: "240000.00", netPay: "186014.76",
    }).where(eq(payrollRuns.id, f.run.id)).returning();

    globalThis.fetch = async (url, init) => {
      const uri = String(url);
      if (uri === "https://api.xendit.co/v3/payouts" && init?.method === "POST") {
        const sent = JSON.parse(String(init.body)) as {
          reference_id: string; payout_details: { source_amount: number };
        };
        assert.equal(sent.payout_details.source_amount, 1550123);
        sends += 1;
        const payoutId = `po-${String(f.run.id).padStart(8, "0")}-0000-4000-8000-${String(sends).padStart(12, "0")}`;
        byPayoutId.set(payoutId, sent.reference_id);
        return Response.json({
          payout_id: payoutId, reference_id: sent.reference_id,
          source_currency: "PHP", source_amount: 1550123,
          destination_currency: "PHP", business_id: f.businessId,
          status: "ACCEPTED",
        });
      }
      const payoutId = uri.split("/").at(-1) ?? "";
      const reference = byPayoutId.get(payoutId);
      if (!reference) throw new Error("Unexpected provider GET: " + uri);
      return Response.json({
        payout_id: payoutId, reference_id: reference,
        source_currency: "PHP", source_amount: 1550123,
        destination_currency: "PHP", business_id: f.businessId,
        status: "SUCCEEDED",
      });
    };
    assert.equal((await preflightXenditPayroll(run, "CI operator")).transferCount, 12);
    for (let i = 0; i < 4; i += 1) {
      await submitXenditPayroll(run, "CI operator");
    }
    assert.equal(sends, 12);
    const first = await reconcileXenditPayroll(run, "CI checker");
    assert.equal(first.checked, 10);
    assert.equal(first.hasMore, true);
    assert.ok(first.nextCursor > 0);
    const second = await reconcileXenditPayroll(run, "CI checker", first.nextCursor);
    assert.equal(second.checked, 2);
    assert.equal(second.hasMore, false);
    assert.equal(second.ledger?.counts.succeeded, 12);
    assert.equal(second.ledger?.status, "settled");
    assert.equal(sends, 12, "Status reads must never send additional salaries");
  } finally {
    globalThis.fetch = previousFetch;
    f.restore();
  }
});


test("previous provider or final bank-file evidence blocks Xendit before any money-moving operation", async () => {
  const scenarios = [
    { action: "Payroll payout completed manually", metadata: {} },
    { action: "Payroll payout submitted via PayMongo", metadata: { batchId: "legacy-1" } },
    { action: "bank export generated", metadata: { kind: "bank", dryRun: false } },
  ];
  for (const scenario of scenarios) {
    const f = await fixture();
    try {
      await db.insert(auditEvents).values({
        organizationId: f.org.id, actor: "Synthetic payroll checker",
        action: scenario.action, resource: f.run.periodLabel,
        metadata: { runId: f.run.id, ...scenario.metadata },
      });
      await assert.rejects(
        preflightXenditPayroll(f.run, "CI operator"),
        /XENDIT_PREVIOUS_PAYOUT_OR_BANK_FILE_UNCERTAIN/,
      );
      await assert.rejects(
        submitXenditPayroll(f.run, "CI operator"),
        /XENDIT_PREVIOUS_PAYOUT_OR_BANK_FILE_UNCERTAIN/,
      );
      assert.equal(await xenditPayoutLedger(f.org.id, f.run.id), null,
        "Blocked alternative payouts may not create an Xendit payment ledger");
    } finally {
      f.restore();
    }
  }
});

test("dry-run bank validation is not mistaken for an externally paid bank file", async () => {
  const f = await fixture();
  try {
    await db.insert(auditEvents).values({
      organizationId: f.org.id, actor: "Synthetic bank validator",
      action: "bank export generated", resource: f.run.periodLabel,
      metadata: { runId: f.run.id, kind: "bank", dryRun: true },
    });
    assert.equal((await preflightXenditPayroll(f.run, "CI operator")).ready, true);
    assert.equal(await xenditPayoutLedger(f.org.id, f.run.id), null);
  } finally {
    f.restore();
  }
});
