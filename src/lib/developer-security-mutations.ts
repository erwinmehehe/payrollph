import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys, auditEvents, webhookEndpoints } from "@/db/schema";

/**
 * Developer credentials and endpoint creation/revocation must commit WITH the
 * matching immutable audit receipt. No externally usable key/webhook may remain
 * after an audit insertion failure, and revocation must not persist unaudited.
 *
 * Callers enforce session, employer membership, company-wide developer role,
 * real MFA, same-origin policy, rate limits and webhook destination validation.
 * These functions never send webhooks or change payroll/release state.
 */
export async function createDeveloperApiKeyWithAudit(input: {
  organizationId: number;
  actor: string;
  name: string;
  prefix: string;
  keyHash: string;
  scopes: string[];
}) {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(apiKeys).values({
      organizationId: input.organizationId,
      name: input.name,
      prefix: input.prefix,
      keyHash: input.keyHash,
      scopes: input.scopes,
    }).returning();
    await tx.insert(auditEvents).values({
      organizationId: input.organizationId,
      actor: input.actor,
      action: "API key created",
      resource: row.name,
      metadata: { prefix: row.prefix, scopes: row.scopes },
    });
    return row;
  });
}

export async function revokeDeveloperApiKeyWithAudit(input: {
  organizationId: number;
  keyId: number;
  actor: string;
}) {
  return db.transaction(async (tx) => {
    const [row] = await tx.update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, input.keyId), eq(apiKeys.organizationId, input.organizationId)))
      .returning();
    if (!row) return null;
    await tx.insert(auditEvents).values({
      organizationId: input.organizationId,
      actor: input.actor,
      action: "API key revoked",
      resource: row.name,
      metadata: { prefix: row.prefix },
    });
    return row;
  });
}

export async function createDeveloperWebhookWithAudit(input: {
  organizationId: number;
  actor: string;
  url: string;
  secret: string;
  events: string[];
}) {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(webhookEndpoints).values({
      organizationId: input.organizationId,
      url: input.url,
      secret: input.secret,
      events: input.events,
    }).returning();
    await tx.insert(auditEvents).values({
      organizationId: input.organizationId,
      actor: input.actor,
      action: "Webhook endpoint created",
      resource: row.url,
      metadata: { events: row.events },
    });
    return row;
  });
}
