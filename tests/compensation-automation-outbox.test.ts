import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { COMPENSATION_RECOVERY_PURPOSE, compensationRecoveryApprovalMessage } from "../src/lib/compensation-recovery-approval";
import test from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import {
  auditEvents,
  automationEventLog,
  compensationAutomationIntents,
  compensationEvents,
  employees,
  organizations,
} from "../src/db/schema";
import {
  compensationAutomationRetryDelayMs,
  dispatchCompensationAutomationIntent,
  drainCompensationAutomationIntents,
  enqueueCompensationAutomationIntents,
  inspectCompensationAutomationIntents,
  retryUnstartedCompensationAutomationIntent,
} from "../src/lib/compensation-automation-outbox";

type Fixture = { organizationId: number; employeeId: number; compensationEventId: number; eventKey: string };
async function withFixture(exercise: (fixture: Fixture) => Promise<void>) {
  const [org] = await db.insert(organizations).values({
    name: "Compensation Dispatch QA",
    legalName: "Compensation Dispatch QA Inc.",
    plan: "Core",
  }).returning();
  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "AUTO-001",
      firstName: "Dispatch",
      lastName: "QA",
      title: "Operations",
      avatarInitials: "DQ",
      basicRate: "30000.00",
      startDate: "2026-01-01",
    }).returning();
    const [event] = await db.insert(compensationEvents).values({
      organizationId: org.id,
      employeeId: employee.id,
      eventType: "salary_change",
      effectiveDate: "2026-10-08",
      actorName: "Test payroll checker",
    }).returning();
    await exercise({
      organizationId: org.id,
      employeeId: employee.id,
      compensationEventId: event.id,
      eventKey: `qa-compensation-dispatch:${event.id}:${randomUUID()}`,
    });
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
}

async function persist(f: Fixture) {
  const [row] = await db.transaction(async (tx) =>
    enqueueCompensationAutomationIntents(tx, {
      organizationId: f.organizationId,
      employeeId: f.employeeId,
      compensationEventId: f.compensationEventId,
      intents: [{
        trigger: "compensation.changed",
        eventKey: f.eventKey,
        context: { syntheticSource: "audited salary change", sampleValue: 999 },
      }],
    }),
  );
  return row.id;
}

async function readIntent(id: number) {
  const [row] = await db.select().from(compensationAutomationIntents)
    .where(eq(compensationAutomationIntents.id, id)).limit(1);
  assert.ok(row);
  return row;
}

const recoveryKeys = generateKeyPairSync("ed25519");
process.env.COMPENSATION_RECOVERY_APPROVER_PUBLIC_KEY = recoveryKeys.publicKey.export({ type: "spki", format: "pem" }).toString();
process.env.COMPENSATION_RECOVERY_OPERATOR_ID = "qa-operator";

async function signTestRecoveryApproval(organizationId: number, intentId: number) {
  const row = await readIntent(intentId);
  const now = new Date();
  const payload = {
    version: 1 as const,
    purpose: COMPENSATION_RECOVERY_PURPOSE,
    organizationId,
    intentId,
    reviewerId: "qa-independent-reviewer",
    operatorId: "qa-operator",
    ticketId: "QA-RECOVERY-1234",
    intentUpdatedAt: row.updatedAt.toISOString(),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
  };
  return {
    ...payload,
    signature: sign(null, Buffer.from(compensationRecoveryApprovalMessage(payload)), recoveryKeys.privateKey).toString("base64url"),
  };
}

test("retry backoff is deterministic and bounded", () => {
  assert.equal(compensationAutomationRetryDelayMs(1), 60000);
  assert.equal(compensationAutomationRetryDelayMs(2), 120000);
  assert.equal(compensationAutomationRetryDelayMs(3), 240000);
  assert.equal(compensationAutomationRetryDelayMs(5), 960000);
  assert.equal(compensationAutomationRetryDelayMs(20), 960000);
});

test("durable intent written with financial commit can be delivered later without a second pay event", async () => {
  await withFixture(async (f) => {
    const id = await persist(f);
    assert.equal((await readIntent(id)).status, "pending");
    const first = await dispatchCompensationAutomationIntent(id);
    assert.equal(first.status, "dispatched");
    const ledger = await db.select().from(automationEventLog).where(and(
      eq(automationEventLog.organizationId, f.organizationId),
      eq(automationEventLog.eventKey, f.eventKey),
    ));
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].source, "authoritative");
    const after = await readIntent(id);
    assert.equal(after.status, "dispatched");
    assert.equal(after.attempts, 1);
    assert.equal((await dispatchCompensationAutomationIntent(id)).status, "skipped");
    const storedEvents = await db.select().from(compensationEvents)
      .where(eq(compensationEvents.id, f.compensationEventId));
    assert.equal(storedEvents.length, 1);
    assert.ok(!JSON.stringify(first).includes("sampleValue"));
  });
});

test("competing dispatch workers cannot claim the same compensation intent twice", async () => {
  await withFixture(async (f) => {
    const id = await persist(f);
    const attempts = await Promise.all([
      dispatchCompensationAutomationIntent(id),
      dispatchCompensationAutomationIntent(id),
    ]);
    assert.equal(attempts.filter((v) => v.status === "dispatched").length, 1);
    assert.equal(attempts.filter((v) => v.status === "skipped").length, 1);
    const [intent] = await db.select().from(compensationAutomationIntents)
      .where(eq(compensationAutomationIntents.id, id));
    assert.equal(intent.attempts, 1);
    const events = await db.select().from(automationEventLog).where(and(
      eq(automationEventLog.organizationId, f.organizationId),
      eq(automationEventLog.eventKey, f.eventKey),
    ));
    assert.equal(events.length, 1);
  });
});

test("failed pre-ledger delivery schedules retry and scheduler drains it after transient recovery", async () => {
  await withFixture(async (f) => {
    const id = await persist(f);
    const token = randomUUID().replaceAll("-", "");
    const fn = `qa_auto_retry_fn_${token}`;
    const trigger = `qa_auto_retry_tr_${token}`;
    await db.execute(sql.raw(`CREATE FUNCTION "${fn}"() RETURNS trigger AS $$
      BEGIN
        IF NEW.event_key = '${f.eventKey}'
        THEN RAISE EXCEPTION 'Synthetic automation ledger outage'; END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`));
    try {
      await db.execute(sql.raw(`CREATE TRIGGER "${trigger}"
        BEFORE INSERT ON "automation_event_log" FOR EACH ROW EXECUTE FUNCTION "${fn}"()`));
      const started = new Date();
      const first = await dispatchCompensationAutomationIntent(id, started);
      assert.equal(first.status, "retry");
      const row = await readIntent(id);
      assert.equal(row.status, "retry");
      assert.equal(row.attempts, 1);
      assert.equal(row.nextAttemptAt.getTime(), started.getTime() + 60000);
      assert.equal((await dispatchCompensationAutomationIntent(id, started)).status, "skipped");
    } finally {
      await db.execute(sql.raw(`DROP TRIGGER IF EXISTS "${trigger}" ON "automation_event_log"`));
      await db.execute(sql.raw(`DROP FUNCTION IF EXISTS "${fn}"()`));
    }

    // The scheduler resumes the saved event; it does not rerun compensation.
    const drained = await drainCompensationAutomationIntents(
      new Date(Date.now() + 3 * 60 * 1000),
      20,
    );
    assert.ok(drained.dispatched >= 1);
    assert.equal((await readIntent(id)).status, "dispatched");
    const events = await db.select().from(automationEventLog).where(
      eq(automationEventLog.eventKey, f.eventKey),
    );
    assert.equal(events.length, 1);
  });
});

test("pre-existing automation ledger quarantines an ambiguous intent instead of replaying actions", async () => {
  await withFixture(async (f) => {
    const id = await persist(f);
    await db.insert(automationEventLog).values({
      organizationId: f.organizationId,
      employeeId: f.employeeId,
      trigger: "compensation.changed",
      eventKey: f.eventKey,
      context: { simulated: "prior execution might have reached provider" },
    });
    const result = await dispatchCompensationAutomationIntent(id);
    assert.equal(result.status, "needs_review");
    assert.equal((await readIntent(id)).status, "needs_review");
    assert.equal((await dispatchCompensationAutomationIntent(id)).status, "skipped");
    await assert.rejects(retryUnstartedCompensationAutomationIntent({
      organizationId: f.organizationId,
      intentId: id,
      approval: await signTestRecoveryApproval(f.organizationId, id),
    }), /Only exhausted pre-ledger retries/i);

    // Ledger cleanup must never turn prior ambiguity into "unstarted" proof.
    await db.delete(automationEventLog).where(and(
      eq(automationEventLog.organizationId, f.organizationId),
      eq(automationEventLog.eventKey, f.eventKey),
    ));
    await assert.rejects(retryUnstartedCompensationAutomationIntent({
      organizationId: f.organizationId,
      intentId: id,
      approval: await signTestRecoveryApproval(f.organizationId, id),
    }), /Only exhausted pre-ledger retries/i);
    assert.equal((await readIntent(id)).status, "needs_review");
  });
});

test("expired dispatch lease is quarantined and cannot be blindly requeued", async () => {
  await withFixture(async (f) => {
    const id = await persist(f);
    await db.update(compensationAutomationIntents).set({
      status: "leased",
      attempts: 1,
      leaseUntil: new Date(Date.now() - 60_000),
    }).where(eq(compensationAutomationIntents.id, id));
    const drained = await drainCompensationAutomationIntents(new Date(), 10);
    assert.ok(drained.quarantined.includes(id));
    const row = await readIntent(id);
    assert.equal(row.status, "needs_review");
    assert.equal(row.attempts, 1);
    assert.equal((await db.select().from(automationEventLog)
      .where(eq(automationEventLog.eventKey, f.eventKey))).length, 0);
    await assert.rejects(retryUnstartedCompensationAutomationIntent({
      organizationId: f.organizationId,
      intentId: id,
      approval: await signTestRecoveryApproval(f.organizationId, id),
    }), /expired dispatch lease/i);
  });
});

test("explicit pre-ledger recovery is tenant-scoped and records a human audit without changing pay", async () => {
  await withFixture(async (f) => {
    const id = await persist(f);
    await db.update(compensationAutomationIntents).set({
      status: "needs_review",
      attempts: 5,
      lastError: "Maximum pre-ledger retry attempts reached. Human reconciliation required.",
    }).where(eq(compensationAutomationIntents.id, id));
    await assert.rejects(retryUnstartedCompensationAutomationIntent({
      organizationId: f.organizationId + 1000000,
      intentId: id,
      approval: await signTestRecoveryApproval(f.organizationId, id),
    }), /does not match requested employer/i);
    const beforeEvents = await db.select().from(compensationEvents)
      .where(eq(compensationEvents.id, f.compensationEventId));
    const resumed = await retryUnstartedCompensationAutomationIntent({
      organizationId: f.organizationId,
      intentId: id,
      approval: await signTestRecoveryApproval(f.organizationId, id),
    });
    assert.equal(resumed.status, "retry");
    const intent = await readIntent(id);
    assert.equal(intent.status, "retry");
    assert.equal(intent.attempts, 0);
    const audit = await db.select().from(auditEvents)
      .where(eq(auditEvents.organizationId, f.organizationId));
    assert.ok(audit.some((row) => row.action === "Compensation automation pre-ledger retry authorized"
      && (row.metadata as { intentId: number }).intentId === id));
    const afterEvents = await db.select().from(compensationEvents)
      .where(eq(compensationEvents.id, f.compensationEventId));
    assert.deepEqual(afterEvents, beforeEvents);
    assert.equal((await dispatchCompensationAutomationIntent(id)).status, "dispatched");
  });
});

test("manual recovery rejects false pre-ledger retry exhaustion even with no automation ledger", async () => {
  await withFixture(async (f) => {
    const id = await persist(f);
    await db.update(compensationAutomationIntents).set({
      status: "needs_review",
      attempts: 4,
      lastError: "Maximum pre-ledger retry attempts reached. Human reconciliation required.",
    }).where(eq(compensationAutomationIntents.id, id));
    await assert.rejects(retryUnstartedCompensationAutomationIntent({
      organizationId: f.organizationId,
      intentId: id,
      approval: await signTestRecoveryApproval(f.organizationId, id),
    }), /Only exhausted pre-ledger retries/i);
    assert.equal((await readIntent(id)).status, "needs_review");
  });
});

test("outbox insertion failure rolls back the financial event in the same transaction", async () => {
  await withFixture(async (f) => {
    const token = randomUUID().replaceAll("-", "");
    const fn = `qa_auto_atomic_fn_${token}`;
    const trigger = `qa_auto_atomic_tr_${token}`;
    const eventKey = `qa-atomic-failure:${token}`;
    await db.execute(sql.raw(`CREATE FUNCTION "${fn}"() RETURNS trigger AS $$
      BEGIN
        IF NEW.event_key = '${eventKey}'
        THEN RAISE EXCEPTION 'Synthetic automation outbox outage'; END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`));
    try {
      await db.execute(sql.raw(`CREATE TRIGGER "${trigger}"
        BEFORE INSERT ON "compensation_automation_intents" FOR EACH ROW EXECUTE FUNCTION "${fn}"()`));
      await assert.rejects(db.transaction(async (tx) => {
        const [financial] = await tx.insert(compensationEvents).values({
          organizationId: f.organizationId,
          employeeId: f.employeeId,
          eventType: "component_activated",
          effectiveDate: "2026-10-10",
        }).returning();
        await enqueueCompensationAutomationIntents(tx, {
          organizationId: f.organizationId,
          employeeId: f.employeeId,
          compensationEventId: financial.id,
          intents: [{
            trigger: "compensation.changed",
            eventKey,
            context: { synthetic: "must not reach provider" },
          }],
        });
      }));
      const events = await db.select().from(compensationEvents)
        .where(eq(compensationEvents.organizationId, f.organizationId));
      assert.equal(events.length, 1, "only the pre-existing committed fixture event survives");
      const pending = await db.select().from(compensationAutomationIntents)
        .where(eq(compensationAutomationIntents.organizationId, f.organizationId));
      assert.equal(pending.length, 0);
    } finally {
      await db.execute(sql.raw(`DROP TRIGGER IF EXISTS "${trigger}" ON "compensation_automation_intents"`));
      await db.execute(sql.raw(`DROP FUNCTION IF EXISTS "${fn}"()`));
    }
  });
});

test("queue review is read-only, tenant-scoped and excludes stored compensation amounts", async () => {
  await withFixture(async (first) => {
    await withFixture(async (second) => {
      const firstId = await persist(first);
      const secondId = await persist(second);
      const firstPage = await inspectCompensationAutomationIntents({
        organizationId: first.organizationId,
        afterId: 0,
        limit: 1,
      });
      assert.equal(firstPage.examined, 1);
      assert.equal(firstPage.rows[0].id, firstId);
      assert.equal(firstPage.rows[0].status, "pending");
      assert.equal(firstPage.readOnly, true);
      assert.equal(firstPage.financiallyCertified, false);
      assert.ok(!JSON.stringify(firstPage).includes("sampleValue"));
      assert.ok(!JSON.stringify(firstPage).includes("999"));
      assert.ok(!firstPage.rows.some((row) => row.id === secondId));
      const otherPage = await inspectCompensationAutomationIntents({
        organizationId: second.organizationId,
      });
      assert.equal(otherPage.rows[0].id, secondId);
      await assert.rejects(inspectCompensationAutomationIntents({ organizationId: 0 }));
      await assert.rejects(inspectCompensationAutomationIntents({
        organizationId: first.organizationId, afterId: -1,
      }));
      await assert.rejects(inspectCompensationAutomationIntents({
        organizationId: first.organizationId, limit: 251,
      }));
    });
  });
});


test("tenant and worker source mismatch cannot enqueue, dispatch or manually retry compensation automation", async () => {
  await withFixture(async (first) => {
    await withFixture(async (second) => {
      // The underlying column foreign keys allow valid foreign rows from
      // another tenant, so the outbox must bind the three IDs itself.
      await assert.rejects(
        db.transaction(async (tx) => enqueueCompensationAutomationIntents(tx, {
          organizationId: first.organizationId,
          employeeId: second.employeeId,
          compensationEventId: first.compensationEventId,
          intents: [{
            trigger: "compensation.changed",
            eventKey: first.eventKey + ":forged",
            context: { mustNeverDispatch: true },
          }],
        })),
        /source must match/i,
      );

      const id = await persist(first);
      await db.update(compensationAutomationIntents).set({
        employeeId: second.employeeId,
      }).where(eq(compensationAutomationIntents.id, id));
      const outcome = await dispatchCompensationAutomationIntent(id);
      assert.equal(outcome.status, "needs_review");
      const quarantined = await readIntent(id);
      assert.equal(quarantined.status, "needs_review");
      assert.match(quarantined.lastError ?? "", /source mismatch/i);
      const delivered = await db.select().from(automationEventLog).where(and(
        eq(automationEventLog.organizationId, first.organizationId),
        eq(automationEventLog.eventKey, first.eventKey),
      ));
      assert.equal(delivered.length, 0, "a mismatched worker must never reach the automation ledger");
      await assert.rejects(retryUnstartedCompensationAutomationIntent({
        organizationId: first.organizationId,
        intentId: id,
        reviewer: "Independent security reviewer",
      }), /source mismatch/i);
      assert.equal((await readIntent(id)).status, "needs_review");
    });
  });
});

test("non-financial source events and spoofed outbox triggers never execute Automation Studio actions", async () => {
  await withFixture(async (f) => {
    await db.update(compensationEvents).set({ eventType: "component_cancelled" })
      .where(eq(compensationEvents.id, f.compensationEventId));
    await assert.rejects(
      db.transaction(async (tx) => enqueueCompensationAutomationIntents(tx, {
        organizationId: f.organizationId,
        employeeId: f.employeeId,
        compensationEventId: f.compensationEventId,
        intents: [{ trigger: "compensation.changed", eventKey: f.eventKey, context: {} }],
      })),
      /allowed event type/i,
    );
    assert.equal((await db.select().from(compensationAutomationIntents)
      .where(eq(compensationAutomationIntents.organizationId, f.organizationId))).length, 0);

    await db.update(compensationEvents).set({ eventType: "salary_change" })
      .where(eq(compensationEvents.id, f.compensationEventId));
    const id = await persist(f);
    await db.update(compensationAutomationIntents)
      .set({ trigger: "employee.terminated" })
      .where(eq(compensationAutomationIntents.id, id));

    const blocked = await dispatchCompensationAutomationIntent(id);
    assert.equal(blocked.status, "needs_review");
    const stored = await readIntent(id);
    assert.match(stored.lastError ?? "", /forbidden event trigger/i);
    assert.equal((await db.select().from(automationEventLog)
      .where(eq(automationEventLog.organizationId, f.organizationId))).length, 0);

    await db.update(compensationAutomationIntents)
      .set({
        status: "needs_review",
        attempts: 5,
        lastError: "Maximum pre-ledger retry attempts reached. Human reconciliation required.",
      }).where(eq(compensationAutomationIntents.id, id));
    await assert.rejects(retryUnstartedCompensationAutomationIntent({
      organizationId: f.organizationId,
      intentId: id,
      reviewer: "Verified human",
    }), /forbidden trigger/i);
    assert.equal((await readIntent(id)).status, "needs_review");
  });
});
