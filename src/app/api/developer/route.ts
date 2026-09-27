import { randomBytes } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys, webhookDeliveries, webhookEndpoints } from "@/db/schema";
import { mintApiKey } from "@/lib/api-auth";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { dispatchWebhook, WEBHOOK_EVENTS } from "@/lib/webhooks";
import { assertPermission } from "@/lib/access";
import { demoMutationBlocked } from "@/lib/demo";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const organizationId = Number(searchParams.get("organizationId") ?? "1");
  const deniedOrg = await assertPermission(user.id, organizationId, "integrations:read");
  if (deniedOrg) return deniedOrg;

  const [keys, endpoints, deliveries] = await Promise.all([
    db.select().from(apiKeys).where(eq(apiKeys.organizationId, organizationId)).orderBy(desc(apiKeys.id)),
    db.select().from(webhookEndpoints).where(eq(webhookEndpoints.organizationId, organizationId)).orderBy(desc(webhookEndpoints.id)),
    db.select().from(webhookDeliveries).where(eq(webhookDeliveries.organizationId, organizationId)).orderBy(desc(webhookDeliveries.id)).limit(20),
  ]);

  return Response.json({
    apiKeys: keys.map((key) => ({
      id: key.id,
      name: key.name,
      prefix: key.prefix,
      scopes: key.scopes,
      lastUsedAt: key.lastUsedAt,
      revokedAt: key.revokedAt,
    })),
    webhookEndpoints: endpoints.map((endpoint) => ({
      id: endpoint.id,
      url: endpoint.url,
      events: endpoint.events,
      active: endpoint.active,
    })),
    deliveries,
    availableEvents: WEBHOOK_EVENTS,
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (user.demo) return demoMutationBlocked("Creating API keys or webhooks");

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const action = String(body.action ?? "");
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }
  const deniedDev = await assertPermission(user.id, organizationId, "integrations:manage");
  if (deniedDev) return deniedDev;

  if (action === "create-key") {
    const minted = mintApiKey();
    const [row] = await db.insert(apiKeys).values({
      organizationId,
      name: String(body.name ?? "Untitled key").slice(0, 120),
      prefix: minted.prefix,
      keyHash: minted.keyHash,
      scopes: Array.isArray(body.scopes) && body.scopes.length ? body.scopes : ["employees:read", "payroll:read"],
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "API key created",
      resource: row.name,
      metadata: { prefix: row.prefix, scopes: row.scopes },
    });

    return Response.json({
      id: row.id,
      name: row.name,
      scopes: row.scopes,
      key: minted.key,
      warning: "This key is shown once and stored only as a SHA-256 hash.",
    }, { status: 201 });
  }

  if (action === "revoke-key") {
    const keyId = Number(body.keyId);
    if (!Number.isInteger(keyId)) return Response.json({ error: "keyId is required." }, { status: 400 });
    const [row] = await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, keyId)).returning();
    if (!row) return Response.json({ error: "Key not found." }, { status: 404 });
    await recordAuditEvent({ organizationId, actor: user.name, action: "API key revoked", resource: row.name, metadata: { prefix: row.prefix } });
    return Response.json({ ok: true });
  }

  if (action === "create-webhook") {
    const url = String(body.url ?? "").trim();
    if (!/^https?:\/\//i.test(url)) return Response.json({ error: "A valid http(s) URL is required." }, { status: 400 });
    const events = Array.isArray(body.events) ? body.events : [];
    const [row] = await db.insert(webhookEndpoints).values({
      organizationId,
      url,
      secret: `whsec_${randomBytes(16).toString("hex")}`,
      events,
    }).returning();

    await recordAuditEvent({ organizationId, actor: user.name, action: "Webhook endpoint created", resource: url, metadata: { events } });
    return Response.json({ id: row.id, url: row.url, events: row.events, secret: row.secret }, { status: 201 });
  }

  if (action === "test-webhook") {
    const results = await dispatchWebhook({
      organizationId,
      event: "payroll.processed",
      data: { test: true, triggeredBy: user.name, at: new Date().toISOString() },
    });
    return Response.json({ attempted: results.length, results });
  }

  return Response.json({ error: "Unknown action." }, { status: 400 });
}
