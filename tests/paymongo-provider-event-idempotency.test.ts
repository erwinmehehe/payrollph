import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import { auditEvents, organizations, providerEvents } from "../src/db/schema";

test("PayMongo replay sent concurrently writes exactly one inbox and audit receipt", async () => {
  const [org] = await db.insert(organizations).values({
    name: `provider-event-test-${randomUUID()}`,
    legalName: "Synthetic provider-event test company",
  }).returning({ id: organizations.id });
  const eventId = `evt-synthetic-${randomUUID()}`;
  try {
    const record = () => db.transaction(async (tx) => {
      const [created] = await tx.insert(providerEvents).values({
        provider: "paymongo",
        eventId,
        organizationId: org.id,
        eventType: "transfer.updated",
      }).onConflictDoNothing({
        target: [providerEvents.provider, providerEvents.eventId],
      }).returning({ id: providerEvents.id });
      if (!created) return false;
      await tx.insert(auditEvents).values({
        organizationId: org.id,
        actor: "PayMongo webhook",
        action: "PayMongo transfer webhook received",
        resource: "Synthetic run",
        metadata: { eventId },
      });
      return true;
    });
    const results = await Promise.all([record(), record()]);
    assert.deepEqual(results.sort(), [false, true]);
    const stored = await db.select().from(providerEvents).where(and(
      eq(providerEvents.provider, "paymongo"),
      eq(providerEvents.eventId, eventId),
    ));
    assert.equal(stored.length, 1);
    const audits = await db.select().from(auditEvents).where(eq(auditEvents.organizationId, org.id));
    assert.equal(audits.filter((item) =>
      item.action === "PayMongo transfer webhook received"
      && (item.metadata as Record<string, unknown>)?.eventId === eventId).length, 1);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("PayMongo webhook's transaction claims uniqueness after validating transfer snapshot", () => {
  const source = readFileSync("src/app/api/webhooks/paymongo/transfers/route.ts", "utf8");
  const validation = source.indexOf("storedTransferForRun(events, {");
  const insert = source.indexOf("tx.insert(providerEvents)");
  const audit = source.indexOf("tx.insert(auditEvents)");
  assert.ok(validation > 0 && insert > validation && audit > insert);
  assert.ok(source.includes("onConflictDoNothing"));
  assert.ok(!source.includes("events.find((row) => {"));
});

test("pending DBA SQL enforces globally unique provider remote event ids", () => {
  const sql = readFileSync("docs/sql/pending-provider-events-inbox.sql", "utf8");
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "provider_events_provider_event_id_unique"/);
  assert.match(sql, /ON "provider_events" \("provider", "event_id"\)/);
});
