import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq } from "drizzle-orm";
import { Client } from "pg";
import { db } from "../src/db";
import {
  auditEvents, employees, legalEntities, organizations, payrollEntries,
  payrollRuns, payoutBatches, payoutBatchTransfers, payoutTransfers, providerEvents,
} from "../src/db/schema";
import { prepareInitialPayoutBatch } from "../src/lib/payout-ledger";
import { reconcileXenditPayroll } from "../src/lib/xendit-payroll-operations";
import { claimNextXenditPayout, xenditPayoutLedger } from "../src/lib/xendit-payout-ledger";
import { POST as webhookPOST } from "../src/app/api/webhooks/xendit-payout/route";

// Disposable localhost PostgreSQL only. No money-out flags or provider HTTP.
function isolatedCiDatabase(): string | null {
  const raw = process.env.DATABASE_URL;
  if (process.env.CI !== "true" || !raw) return null;
  const u = new URL(raw);
  if (u.protocol !== "postgresql:" || u.hostname !== "127.0.0.1"
    || u.port !== "5432" || u.pathname !== "/app_db"
    || u.username !== "postgres" || u.password !== "postgres"
    || u.search || u.hash) return null;
  return raw;
}

test("Xendit claim + webhook replay use overlapping PostgreSQL transactions, one claim and audit per event", {
  skip: !isolatedCiDatabase(), timeout: 60_000,
}, async () => {
  assert.notEqual(process.env.XENDIT_PAYOUTS_ENABLED, "true");
  assert.notEqual(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "true");
  const [org] = await db.insert(organizations).values({
    name: "Fictional payout overlap " + randomUUID(),
    legalName: "Fictional Payout Ltd - No Funds",
  }).returning({ id: organizations.id });
  const keys = [
    "XENDIT_PAYOUT_CALLBACK_TOKEN", "XENDIT_PAYOUT_BUSINESS_ID",
    "XENDIT_PAYOUT_ALLOWED_ORGANIZATION_ID", "XENDIT_PAYOUT_ALLOWED_LEGAL_ENTITY_ID",
    "XENDIT_PAYOUT_SECRET_KEY",
  ];
  const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const holder = new Client({ connectionString: isolatedCiDatabase()! });
  let opened = false;
  try {
    const [entity] = await db.insert(legalEntities).values({
      organizationId: org.id, code: "FIC", displayName: "Fictional Employer",
      legalName: "Fictional Employer Ltd", primaryEntity: true,
    }).returning({ id: legalEntities.id });
    const [person] = await db.insert(employees).values({
      organizationId: org.id, legalEntityId: entity.id, employeeNo: "FIC001",
      firstName: "Fictional", lastName: "Employee", title: "Tester",
      avatarInitials: "FE", basicRate: "10000.00", startDate: "2026-10-01",
    }).returning({ id: employees.id });
    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id, legalEntityId: entity.id,
      periodLabel: "Synthetic no-money Xendit overlap",
      periodStart: "2026-10-01", periodEnd: "2026-10-15",
      payDate: "2026-10-20", status: "Released", employeeCount: 1,
      grossPay: "100.00", netPay: "100.00",
    }).returning();
    const [entry] = await db.insert(payrollEntries).values({
      payrollRunId: run.id, employeeId: person.id,
      grossPay: "100.00", deductions: "0.00", netPay: "100.00",
    }).returning({ id: payrollEntries.id });
    const referenceNumber = "PAY-" + run.id + "-FIC001";
    const batch = await prepareInitialPayoutBatch({
      organizationId: org.id, payrollRunId: run.id, provider: "xendit",
      intents: [{
        employeeId: person.id, payrollEntryId: entry.id,
        referenceNumber, amountCents: 10000,
      }],
    });
    const businessId = "biz-fic-" + org.id;
    Object.assign(process.env, {
      XENDIT_PAYOUT_CALLBACK_TOKEN: "synthetic-callback-token-never-live",
      XENDIT_PAYOUT_BUSINESS_ID: businessId,
      XENDIT_PAYOUT_ALLOWED_ORGANIZATION_ID: String(org.id),
      XENDIT_PAYOUT_ALLOWED_LEGAL_ENTITY_ID: String(entity.id),
      // Synthetic credential only reaches our in-process GET stub below.
      // Neither payout activation flag is changed, and no external HTTP is allowed.
      XENDIT_PAYOUT_SECRET_KEY: "xnd_synthetic_read_only_reconciliation_fixture",
    });

    await holder.connect();
    const holdBatch = async () => {
      await holder.query("BEGIN");
      opened = true;
      await holder.query("SELECT id FROM payout_batches WHERE id = $1 FOR UPDATE", [batch.batchId]);
    };
    const release = async () => {
      await holder.query("COMMIT");
      opened = false;
    };

    // An independent PG row lock blocks two real service transactions.
    await holdBatch();
    let finishedClaims = 0;
    const claims = [0, 1].map(() =>
      claimNextXenditPayout({ organizationId: org.id, payrollRunId: run.id })
        .then((row) => { finishedClaims++; return row; }));
    try {
      await delay(75);
      assert.equal(finishedClaims, 0, "claim attempts are waiting for PG row lock");
    } finally { await release(); }
    const claimOutcomes = await Promise.allSettled(claims);
    assert.equal(claimOutcomes.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal(claimOutcomes.filter((x) => x.status === "rejected").length, 1);
    assert.equal((await xenditPayoutLedger(org.id, run.id))?.rows[0]?.status, "submitting");

    const payoutId = "po-fic-" + randomUUID();
    const sendEvent = async (eventId: string, event: string, status: string) => {
      const response = await webhookPOST(new Request("http://localhost/api/webhooks/xendit-payout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-callback-token": "synthetic-callback-token-never-live",
          "webhook-id": eventId,
        },
        body: JSON.stringify({
          created: "2026-10-22T12:00:00.000Z", event, business_id: businessId,
          data: {
            payout_id: payoutId, reference_id: referenceNumber, status,
            source_amount: 10000, source_currency: "PHP",
            destination_currency: "PHP", business_id: businessId,
          },
        }),
      }));
      return { code: response.status, body: await response.json() as { accepted?: boolean; duplicate?: boolean } };
    };

    const pendingId = "evt-pending-" + randomUUID();
    assert.deepEqual(await sendEvent(pendingId, "v3_payout.pending_compliance", "PENDING_COMPLIANCE_ASSESSMENT"), {
      code: 200, body: { accepted: true, duplicate: false },
    });
    const settledId = "evt-settled-" + randomUUID();
    await holdBatch();
    let finishedEvents = 0;
    const replay = [0, 1].map(() =>
      sendEvent(settledId, "v3_payout.succeeded", "SUCCEEDED")
        .then((result) => { finishedEvents++; return result; }));
    try {
      await delay(75);
      assert.equal(finishedEvents, 0, "webhook attempts are waiting for PG row lock");
    } finally { await release(); }
    const outcomes = await Promise.all(replay);
    assert.equal(outcomes.filter((x) => x.code === 200 && x.body.duplicate === false).length, 1);
    assert.equal(outcomes.filter((x) => x.code === 200 && x.body.duplicate === true).length, 1);
    assert.equal((await xenditPayoutLedger(org.id, run.id))?.rows[0]?.status, "succeeded");
    assert.deepEqual(await sendEvent(pendingId, "v3_payout.pending_compliance", "PENDING_COMPLIANCE_ASSESSMENT"), {
      code: 200, body: { accepted: true, duplicate: true },
    });

    const stored = await db.select().from(providerEvents).where(and(
      eq(providerEvents.organizationId, org.id),
      eq(providerEvents.provider, "xendit"),
    ));
    assert.equal(stored.length, 2);
    const audit = await db.select().from(auditEvents).where(eq(auditEvents.organizationId, org.id));
    assert.equal(audit.filter((row) =>
      row.action === "Xendit payout transfer claimed (provider not yet acknowledged)"
    ).length, 1);
    for (const eventId of [pendingId, settledId]) {
      assert.equal(audit.filter((row) =>
        (row.metadata as Record<string, unknown>).eventId === eventId
      ).length, 1);
    }

    // Manual READ-only reconciliation attempts use an audit-linked retry chain.
    // Provider GETs are intercepted locally; no real request can leave the test.
    const priorFetch = globalThis.fetch;
    let lookupCount = 0;
    try {
      globalThis.fetch = async (input, init) => {
        lookupCount += 1;
        assert.match(String(input), /^https:\/\/api\.xendit\.co\/v3\/payouts\/po-/);
        assert.equal(init?.redirect, "error");
        assert.equal(init?.method ?? "GET", "GET", "never send a money-moving request");
        throw new Error("Synthetic read-only provider timeout");
      };
      await assert.rejects(
        () => reconcileXenditPayroll(run, "Synthetic operator"),
        /Synthetic read-only provider timeout/,
      );
      globalThis.fetch = async (input, init) => {
        lookupCount += 1;
        assert.equal(String(input), "https://api.xendit.co/v3/payouts/" + payoutId);
        assert.equal(init?.method ?? "GET", "GET", "never send a money-moving request");
        assert.equal(init?.redirect, "error");
        return Response.json({
          payout_id: payoutId, reference_id: referenceNumber,
          source_amount: 10000, source_currency: "PHP",
          destination_currency: "PHP", business_id: businessId, status: "SUCCEEDED",
        });
      };
      const result = await reconcileXenditPayroll(run, "Synthetic operator");
      assert.equal(result.checked, 1);
      assert.equal(lookupCount, 2, "exactly two intercepted read-only lookups");
    } finally {
      globalThis.fetch = priorFetch;
    }
    const attempts = await db.select().from(auditEvents).where(eq(auditEvents.organizationId, org.id));
    const initiated = attempts.filter((row) => row.action === "Xendit payout read-only lookup initiated");
    const failed = attempts.filter((row) => row.action === "Xendit payout read-only lookup failed");
    const completed = attempts.filter((row) => row.action === "Xendit payout read-only lookup completed");
    assert.equal(initiated.length, 2);
    assert.equal(failed.length, 1);
    assert.equal(completed.length, 1);
    const meta = (row: typeof initiated[number]) => row.metadata as Record<string, unknown>;
    assert.notEqual(meta(initiated[0]).attemptId, meta(initiated[1]).attemptId);
    assert.equal(meta(initiated[0]).retryOfAttemptId, null);
    assert.equal(meta(initiated[1]).retryOfAttemptId, meta(initiated[0]).attemptId);
    for (const row of [...initiated, ...failed, ...completed]) {
      assert.equal(meta(row).referenceNumber, referenceNumber);
      assert.equal(meta(row).providerPayoutId, payoutId);
    }
    assert.equal(meta(failed[0]).attemptId, meta(initiated[0]).attemptId);
    assert.equal(meta(completed[0]).attemptId, meta(initiated[1]).attemptId);
  } finally {
    if (opened) await holder.query("ROLLBACK").catch(() => {});
    await holder.end().catch(() => {});
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await db.delete(payoutBatchTransfers).where(eq(payoutBatchTransfers.organizationId, org.id));
    await db.delete(payoutTransfers).where(eq(payoutTransfers.organizationId, org.id));
    await db.delete(payoutBatches).where(eq(payoutBatches.organizationId, org.id));
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});
