import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import { auditEvents, organizations, outbox } from "../src/db/schema";
import { recordEmailProviderEvent } from "../src/lib/mailer";

async function createOrg(label: string) {
  const [org] = await db.insert(organizations).values({
    name: "Resend event " + label, legalName: "Fictional resend event " + label,
  }).returning();
  return org;
}

async function insertOutbox(organizationId: number | null, overrides: Partial<typeof outbox.$inferInsert> = {}) {
  const [row] = await db.insert(outbox).values({
    organizationId,
    recipient: "fictional@example.invalid",
    subject: "Fictional subject",
    body: "Fictional body",
    purpose: "payslip-ready",
    provider: "resend",
    status: "sent",
    providerMessageId: "email_" + randomUUID().slice(0, 12),
    deliveryStatus: "accepted",
    ...overrides,
  }).returning();
  return row;
}

const event = (row: { id: number; providerMessageId: string | null }, eventId: string, extra: Record<string, unknown> = {}) => ({
  provider: "resend" as const,
  eventId,
  outboxId: row.id,
  providerMessageId: String(row.providerMessageId),
  eventType: "email.delivered",
  deliveryStatus: "delivered",
  occurredAt: "2026-11-04T10:00:00.000Z",
  detail: null,
  ...extra,
});

const receipts = (organizationId: number, outboxId: number) =>
  db.select().from(auditEvents).where(and(
    eq(auditEvents.organizationId, organizationId),
    eq(auditEvents.action, "Email provider delivery event"),
    eq(auditEvents.resource, "outbox #" + outboxId),
  ));
const stored = async (id: number) => (await db.select().from(outbox).where(eq(outbox.id, id)))[0];

test("an event for a row with no stored provider message id is refused and writes nothing", async () => {
  const org = await createOrg("noid-" + randomUUID().slice(0, 6));
  try {
    const pending = await insertOutbox(org.id, { providerMessageId: null, status: "pending", deliveryStatus: "sending" });
    const nonexistent = await recordEmailProviderEvent({
      ...event({ id: 2_000_000_000, providerMessageId: "email_planted" }, "evt_" + randomUUID()),
    });
    const planted = await recordEmailProviderEvent(event({ id: pending.id, providerMessageId: "email_planted" }, "evt_" + randomUUID()));
    assert.deepEqual(planted, { matched: false, duplicate: false });
    assert.deepEqual(planted, nonexistent, "an unsent real row must be indistinguishable from a nonexistent one");
    const after = await stored(pending.id);
    assert.equal(after.providerMessageId, null, "a signed event must not plant a message id");
    assert.equal(after.deliveryStatus, "sending");
    assert.equal((await receipts(org.id, pending.id)).length, 0);
  } finally {
    await db.delete(outbox).where(eq(outbox.organizationId, org.id));
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("wrong provider or wrong message id is refused with the same body and writes nothing", async () => {
  const org = await createOrg("mismatch-" + randomUUID().slice(0, 6));
  try {
    const row = await insertOutbox(org.id);
    const before = await stored(row.id);
    const wrongId = await recordEmailProviderEvent(event({ id: row.id, providerMessageId: "email_other" }, "evt_" + randomUUID()));
    const wrongProvider = await recordEmailProviderEvent({ ...event(row, "evt_" + randomUUID()), provider: "postmark" });
    assert.deepEqual(wrongId, { matched: false, duplicate: false });
    assert.deepEqual(wrongProvider, wrongId);
    assert.deepEqual(await stored(row.id), before, "refused events leave the row byte-identical");
    assert.equal((await receipts(org.id, row.id)).length, 0);
  } finally {
    await db.delete(outbox).where(eq(outbox.organizationId, org.id));
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("an own genuine event updates only its row and a replay, however old, writes nothing", async () => {
  const orgA = await createOrg("own-a-" + randomUUID().slice(0, 6));
  const orgB = await createOrg("own-b-" + randomUUID().slice(0, 6));
  try {
    const rowA = await insertOutbox(orgA.id);
    const rowB = await insertOutbox(orgB.id);
    const bBefore = await stored(rowB.id);
    const first = event(rowA, "evt_first_" + randomUUID());
    assert.deepEqual(await recordEmailProviderEvent(first), { matched: true, duplicate: false, outboxId: rowA.id });
    assert.equal((await stored(rowA.id)).deliveryStatus, "delivered");
    assert.equal((await receipts(orgA.id, rowA.id)).length, 1);

    // Push more than 500 unrelated delivery receipts after it: the old global 500-row window forgot this event.
    const noise = Array.from({ length: 520 }, (_, i) => ({
      organizationId: orgB.id, actor: "system:resend-webhook", action: "Email provider delivery event",
      resource: "outbox #" + rowB.id, metadata: { provider: "resend", eventId: "evt_noise_" + i },
    }));
    for (let i = 0; i < noise.length; i += 100) await db.insert(auditEvents).values(noise.slice(i, i + 100));

    await db.update(outbox).set({ deliveryStatus: "bounced" }).where(eq(outbox.id, rowA.id));
    assert.deepEqual(await recordEmailProviderEvent(first), { matched: true, duplicate: true, outboxId: rowA.id },
      "an old replay is recognised exactly, not by a recent-event window");
    assert.equal((await stored(rowA.id)).deliveryStatus, "bounced", "a replay must not rewrite delivery state");
    assert.equal((await receipts(orgA.id, rowA.id)).length, 1);
    const bAfter = await stored(rowB.id);
    assert.deepEqual(bAfter, bBefore, "the other employer's row is untouched");
  } finally {
    await db.delete(outbox).where(eq(outbox.organizationId, orgA.id));
    await db.delete(outbox).where(eq(outbox.organizationId, orgB.id));
    await db.delete(organizations).where(eq(organizations.id, orgA.id));
    await db.delete(organizations).where(eq(organizations.id, orgB.id));
  }
});

test("two concurrent deliveries of one event produce exactly one state write and one receipt", async () => {
  const org = await createOrg("race-" + randomUUID().slice(0, 6));
  try {
    const row = await insertOutbox(org.id);
    const same = event(row, "evt_race_" + randomUUID());
    const deliveries = 24;
    const results = await Promise.all(Array.from({ length: deliveries }, () => recordEmailProviderEvent(same)));
    assert.equal(results.filter(r => !r.duplicate).length, 1, "exactly one delivery may be recorded");
    assert.equal(results.filter(r => r.duplicate).length, deliveries - 1);
    assert.equal((await receipts(org.id, row.id)).length, 1);
  } finally {
    await db.delete(outbox).where(eq(outbox.organizationId, org.id));
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("a failing audit write rolls the delivery state back instead of being swallowed", async () => {
  const org = await createOrg("rollback-" + randomUUID().slice(0, 6));
  const fn = "qa_resend_receipt_veto";
  try {
    const row = await insertOutbox(org.id);
    const before = await stored(row.id);
    // Veto only the delivery receipt, so the outbox update runs first and the failure comes from the audit insert.
    await db.execute(sql.raw("CREATE FUNCTION " + fn + "() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'QA_RESEND_RECEIPT_VETO'; END; $$"));
    try {
      await db.execute(sql.raw("CREATE TRIGGER " + fn + " BEFORE INSERT ON audit_events FOR EACH ROW WHEN (NEW.action = 'Email provider delivery event' AND NEW.organization_id = " + org.id + ") EXECUTE FUNCTION " + fn + "()"));
      await assert.rejects(recordEmailProviderEvent(event(row, "evt_veto_" + randomUUID())), /Failed query: insert into "audit_events"/);
    } finally {
      await db.execute(sql.raw("DROP TRIGGER IF EXISTS " + fn + " ON audit_events"));
      await db.execute(sql.raw("DROP FUNCTION IF EXISTS " + fn + "()"));
    }
    assert.deepEqual(await stored(row.id), before, "no partial delivery update may survive a failed receipt");
    assert.equal((await receipts(org.id, row.id)).length, 0);
    // With the veto gone the same event is accepted, proving nothing was recorded as seen.
    assert.deepEqual(await recordEmailProviderEvent(event(row, "evt_veto_after_" + randomUUID())),
      { matched: true, duplicate: false, outboxId: row.id });
  } finally {
    await db.delete(outbox).where(eq(outbox.organizationId, org.id));
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("a system email with no organization is updated by a genuine event and still refused for a wrong id", async () => {
  const row = await insertOutbox(null, { purpose: "demo-request" });
  try {
    assert.equal((await recordEmailProviderEvent(event(row, "evt_sys_" + randomUUID()))).matched, true);
    assert.equal((await stored(row.id)).deliveryStatus, "delivered");
    assert.deepEqual(await recordEmailProviderEvent(event({ id: row.id, providerMessageId: "email_wrong" }, "evt_" + randomUUID())),
      { matched: false, duplicate: false });
  } finally {
    await db.delete(outbox).where(eq(outbox.id, row.id));
  }
});
