import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys, webhookDeliveries, webhookEndpoints } from "@/db/schema";
import { mintApiKey } from "@/lib/api-auth";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { dispatchWebhook, WEBHOOK_EVENTS } from "@/lib/webhooks";
import { validateWebhookTarget } from "@/lib/security-network";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { assertOrganizationRole, getAccess, DEVELOPER_ADMIN_ROLES } from "@/lib/access";
import { enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";
import { clientIp, rateLimitDistributed } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const organizationId = Number(searchParams.get("organizationId") ?? "1");
  const deniedOrg = await assertOrganizationRole(
    user.id,
    organizationId,
    DEVELOPER_ADMIN_ROLES,
    "Only workspace administrators can manage API keys and webhooks.",
  );
  if (deniedOrg) return deniedOrg;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Developer credentials and webhooks require company-wide administrator access." }, { status: 403 });
  }

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
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const demoDenied = publicDemoMutationDenied(user.email, "Developer credentials and webhook mutations");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const action = String(body.action ?? "");
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }
  const deniedDev = await assertOrganizationRole(
    user.id,
    organizationId,
    DEVELOPER_ADMIN_ROLES,
    "Only workspace administrators can manage API keys and webhooks.",
  );
  if (deniedDev) return deniedDev;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Developer credentials and webhooks require company-wide administrator access." }, { status: 403 });
  }
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;

  const mutationLimit = await rateLimitDistributed(
    `developer-mutation:${user.id}:${organizationId}:${clientIp(request)}`,
    { limit: 30, windowMs: 5 * 60_000 },
  );
  if (!mutationLimit.allowed) {
    return Response.json({ error: "Too many developer-security changes. Try again later." }, { status: 429 });
  }

  if (action === "create-key") {
    const minted = mintApiKey();
    const [row] = await db.insert(apiKeys).values({
      organizationId,
      name: String(body.name ?? "Untitled key").slice(0, 120),
      prefix: minted.prefix,
      keyHash: minted.keyHash,
      scopes: normalizeScopes(body.scopes),
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
    const [row] = await db.update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.organizationId, organizationId)))
      .returning();
    if (!row) return Response.json({ error: "Key not found in this workspace." }, { status: 404 });
    await recordAuditEvent({ organizationId, actor: user.name, action: "API key revoked", resource: row.name, metadata: { prefix: row.prefix } });
    return Response.json({ ok: true });
  }

  if (action === "create-webhook") {
    const rawUrl = String(body.url ?? "").trim();
    let url: string;
    try {
      url = await validateWebhookTarget(rawUrl);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Webhook URL is not allowed." },
        { status: 400 },
      );
    }
    const events = Array.isArray(body.events)
      ? body.events.filter((event: unknown): event is string => typeof event === "string" && (WEBHOOK_EVENTS as readonly string[]).includes(event))
      : [];
    if (events.length === 0) {
      return Response.json({ error: "Choose at least one supported webhook event." }, { status: 422 });
    }
    const [row] = await db.insert(webhookEndpoints).values({
      organizationId,
      url,
      secret: `whsec_${randomBytes(32).toString("hex")}`,
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


const ALLOWED_API_SCOPES = new Set(["employees:read", "employees:write", "payroll:read"]);

function normalizeScopes(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return ["employees:read", "payroll:read"];
  const scopes = value.filter((scope): scope is string => typeof scope === "string" && ALLOWED_API_SCOPES.has(scope));
  return scopes.length ? [...new Set(scopes)] : ["employees:read", "payroll:read"];
}
