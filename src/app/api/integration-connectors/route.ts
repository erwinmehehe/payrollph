import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { integrationConnectors } from "@/db/schema";
import { assertOrganizationRole, getAccess, ORG_ADMIN_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import {
  encryptIntegrationCredential,
  integrationCredentialEncryptionConfigured,
} from "@/lib/integration-secret";
import { listSafeIntegrationConnectors } from "@/lib/integration-connectors";
import {
  normalizeSlackConnectorConfig,
  validateSlackBotToken,
  verifySlackConnector,
} from "@/lib/slack-connector";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

async function requireConnectorAdmin(userId: number, organizationId: number) {
  const denied = await assertOrganizationRole(
    userId,
    organizationId,
    ORG_ADMIN_ROLES,
    "Only company-wide administrators can manage integration connectors.",
  );
  if (denied) return denied;
  const access = await getAccess(userId, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Integration connector administration requires company-wide access." }, { status: 403 });
  }
  return null;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }
  const denied = await requireConnectorAdmin(user.id, organizationId);
  if (denied) return denied;

  return Response.json({
    connectors: await listSafeIntegrationConnectors(organizationId),
    providers: [{
      id: "slack",
      name: "Slack",
      credentialConfigured: integrationCredentialEncryptionConfigured(),
      action: "send_slack_message",
    }],
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const demoDenied = publicDemoMutationDenied(user.email, "Integration connectors");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const action = String(body.action ?? "");
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await requireConnectorAdmin(user.id, organizationId);
  if (denied) return denied;
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: `integration-connector-${action || "mutation"}`,
    resourceId: organizationId,
    limit: 20,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (action === "save-slack") {
    if (!integrationCredentialEncryptionConfigured()) {
      return Response.json({
        error: "INTEGRATION_CREDENTIAL_ENCRYPTION_KEY must be configured before Slack connectors can be saved.",
      }, { status: 409 });
    }

    const id = body.id ? Number(body.id) : null;
    const name = String(body.name ?? "").trim().slice(0, 120);
    const botToken = String(body.botToken ?? "").trim();
    const config = normalizeSlackConnectorConfig({
      defaultChannelId: body.defaultChannelId,
      allowedChannelIds: body.allowedChannelIds,
    });
    if (!name || !config) {
      return Response.json({
        error: "Connector name, default Slack channel ID, and 1-50 allow-listed Slack channel IDs are required.",
      }, { status: 400 });
    }

    let existing: typeof integrationConnectors.$inferSelect | null = null;
    if (id) {
      const rows = await db.select().from(integrationConnectors).where(and(
        eq(integrationConnectors.id, id),
        eq(integrationConnectors.organizationId, organizationId),
        eq(integrationConnectors.provider, "slack"),
      )).limit(1);
      existing = rows[0] ?? null;
      if (!existing) return Response.json({ error: "Slack connector not found." }, { status: 404 });
    }

    if (!existing && !botToken) {
      return Response.json({ error: "Slack bot token is required for a new connector." }, { status: 400 });
    }
    if (botToken && !validateSlackBotToken(botToken)) {
      return Response.json({ error: "Slack bot token format is invalid; a bot token beginning with xoxb- is required." }, { status: 400 });
    }

    let encryptedCredential = existing?.credentialCiphertext ?? "";
    let verifiedIdentity = existing?.verifiedIdentity ?? null;
    let verifiedAt = existing?.verifiedAt ?? null;

    if (botToken) {
      try {
        verifiedIdentity = await verifySlackConnector(botToken);
        verifiedAt = new Date();
        encryptedCredential = encryptIntegrationCredential(botToken);
      } catch (error) {
        return Response.json({
          error: error instanceof Error ? error.message : "Slack credential verification failed.",
        }, { status: 409 });
      }
    } else if (!verifiedAt) {
      return Response.json({ error: "Slack connector must have a verified bot credential." }, { status: 409 });
    }

    try {
      const values = {
        organizationId,
        provider: "slack",
        name,
        credentialCiphertext: encryptedCredential,
        config,
        active: existing?.active ?? true,
        verifiedAt,
        verifiedIdentity,
        createdByUserId: existing?.createdByUserId ?? user.id,
        updatedAt: new Date(),
      } as const;

      const [saved] = existing
        ? await db.update(integrationConnectors).set(values).where(and(
            eq(integrationConnectors.id, existing.id),
            eq(integrationConnectors.organizationId, organizationId),
          )).returning()
        : await db.insert(integrationConnectors).values(values).returning();

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: existing ? "Slack connector updated" : "Slack connector created",
        resource: saved.name,
        metadata: {
          connectorId: saved.id,
          provider: "slack",
          credentialRotated: Boolean(botToken && existing),
          defaultChannelId: config.defaultChannelId,
          allowedChannelIds: config.allowedChannelIds,
          verifiedIdentity,
        },
      });

      const safe = (await listSafeIntegrationConnectors(organizationId)).find((connector) => connector.id === saved.id);
      return Response.json(safe, { status: existing ? 200 : 201 });
    } catch (error) {
      const unique = Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505");
      if (unique) return Response.json({ error: "An integration connector with this name already exists." }, { status: 409 });
      throw error;
    }
  }

  if (action === "set-active") {
    const id = Number(body.id);
    if (!Number.isInteger(id)) return Response.json({ error: "id is required." }, { status: 400 });
    const [updated] = await db.update(integrationConnectors).set({
      active: Boolean(body.active),
      updatedAt: new Date(),
    }).where(and(
      eq(integrationConnectors.id, id),
      eq(integrationConnectors.organizationId, organizationId),
      eq(integrationConnectors.provider, "slack"),
    )).returning();
    if (!updated) return Response.json({ error: "Slack connector not found." }, { status: 404 });

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: updated.active ? "Slack connector enabled" : "Slack connector disabled",
      resource: updated.name,
      metadata: { connectorId: updated.id, provider: "slack" },
    });

    const safe = (await listSafeIntegrationConnectors(organizationId)).find((connector) => connector.id === updated.id);
    return Response.json(safe);
  }

  return Response.json({ error: "Unsupported integration connector action." }, { status: 400 });
}
