import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { apiKeys, auditEvents, organizations, webhookEndpoints } from "../src/db/schema";
import {
  createDeveloperApiKeyWithAudit, createDeveloperWebhookWithAudit,
  revokeDeveloperApiKeyWithAudit,
} from "../src/lib/developer-security-mutations";

/** Fictional PostgreSQL data only. The invalid 121-byte actor forces the
 * append-only audit receipt to fail AFTER the mutation has been attempted. */
test("developer keys and webhooks commit only with the matching audit event", async () => {
  const tag = randomUUID().slice(0, 10);
  const [alpha, beta] = await db.insert(organizations).values([
    { name: "Dev audit alpha " + tag, legalName: "Dev audit alpha " + tag },
    { name: "Dev audit beta " + tag, legalName: "Dev audit beta " + tag },
  ]).returning({ id: organizations.id });
  const invalidActor = "X".repeat(121); // audit_events.actor is varchar(120)
  const actor = "Synthetic developer administrator";
  const keyInput = {
    organizationId: alpha.id, name: "Synthetic regression key",
    prefix: "sk_" + tag, keyHash: "synthetic-hash-" + tag,
    scopes: ["employees:read"],
  };
  const webhookInput = {
    organizationId: alpha.id,
    url: "https://webhook.example.test/fictional-" + tag,
    secret: "whsec_synthetic_test_only_" + tag,
    events: ["payroll.processed"],
  };
  const ownKeys = () => db.select({
    id: apiKeys.id, revokedAt: apiKeys.revokedAt,
  }).from(apiKeys).where(eq(apiKeys.organizationId, alpha.id));
  const ownWebhooks = () => db.select({ id: webhookEndpoints.id })
    .from(webhookEndpoints).where(eq(webhookEndpoints.organizationId, alpha.id));
  const ownAudits = () => db.select({
    action: auditEvents.action, metadata: auditEvents.metadata,
  }).from(auditEvents).where(eq(auditEvents.organizationId, alpha.id))
    .orderBy(auditEvents.id);
  try {
    await assert.rejects(createDeveloperApiKeyWithAudit({
      ...keyInput, actor: invalidActor,
    }));
    assert.deepEqual(await ownKeys(), [],
      "An audit failure must roll back a credential that otherwise could be active");
    assert.deepEqual(await ownAudits(), [],
      "A failed transaction must leave neither key nor phantom audit");

    const key = await createDeveloperApiKeyWithAudit({ ...keyInput, actor });
    assert.equal((await ownKeys()).length, 1);
    assert.equal((await ownAudits())[0].action, "API key created");

    await assert.rejects(revokeDeveloperApiKeyWithAudit({
      organizationId: alpha.id, keyId: key.id, actor: invalidActor,
    }));
    assert.equal((await ownKeys())[0].revokedAt, null,
      "Failed revocation audit must preserve the original active-key state");
    assert.equal((await ownAudits()).length, 1);
    assert.equal(await revokeDeveloperApiKeyWithAudit({
      organizationId: beta.id, keyId: key.id, actor,
    }), null, "A foreign employer cannot revoke the key or create a receipt");
    assert.equal((await ownKeys())[0].revokedAt, null);
    const revoked = await revokeDeveloperApiKeyWithAudit({
      organizationId: alpha.id, keyId: key.id, actor,
    });
    assert.ok(revoked?.revokedAt instanceof Date);
    assert.equal((await ownAudits())[1].action, "API key revoked");

    await assert.rejects(createDeveloperWebhookWithAudit({
      ...webhookInput, actor: invalidActor,
    }));
    assert.deepEqual(await ownWebhooks(), [],
      "An external webhook secret must not persist without its audit receipt");
    assert.equal((await ownAudits()).length, 2);
    const webhook = await createDeveloperWebhookWithAudit({ ...webhookInput, actor });
    assert.equal(webhook.url, webhookInput.url);
    assert.equal(webhook.secret, webhookInput.secret);
    assert.equal((await ownWebhooks()).length, 1);
    const receipts = await ownAudits();
    assert.deepEqual(receipts.map(row => row.action), [
      "API key created", "API key revoked", "Webhook endpoint created",
    ]);
    assert.deepEqual(receipts[0].metadata, {
      prefix: keyInput.prefix, scopes: keyInput.scopes,
    });
    assert.deepEqual(receipts[2].metadata, { events: webhookInput.events });
    assert.ok(!JSON.stringify(receipts).includes(webhookInput.secret),
      "Never put webhook secrets into the audit event");
  } finally {
    await db.delete(organizations).where(inArray(organizations.id, [alpha.id, beta.id]));
  }
});
