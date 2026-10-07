import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  integrationConnectorDeliveries,
  integrationConnectors,
} from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { decryptIntegrationCredential } from "@/lib/integration-secret";
import {
  normalizeSlackConnectorConfig,
  sendSlackConnectorMessage,
  type SlackConnectorConfig,
} from "@/lib/slack-connector";

export type SafeIntegrationConnector = {
  id: number;
  provider: "slack";
  name: string;
  active: boolean;
  verifiedAt: Date | null;
  verifiedIdentity: Record<string, unknown> | null;
  config: SlackConnectorConfig;
};

function safeConnector(row: typeof integrationConnectors.$inferSelect): SafeIntegrationConnector | null {
  if (row.provider !== "slack") return null;
  const config = normalizeSlackConnectorConfig(row.config);
  if (!config) return null;
  return {
    id: row.id,
    provider: "slack",
    name: row.name,
    active: row.active,
    verifiedAt: row.verifiedAt,
    verifiedIdentity:
      row.verifiedIdentity && typeof row.verifiedIdentity === "object" && !Array.isArray(row.verifiedIdentity)
        ? row.verifiedIdentity as Record<string, unknown>
        : null,
    config,
  };
}

export async function listSafeIntegrationConnectors(organizationId: number) {
  const rows = await db.select().from(integrationConnectors)
    .where(eq(integrationConnectors.organizationId, organizationId))
    .orderBy(integrationConnectors.name);
  return rows.flatMap((row) => {
    const safe = safeConnector(row);
    return safe ? [safe] : [];
  });
}

export async function deliverSlackAutomationMessage(input: {
  organizationId: number;
  connectorId: number;
  channelId?: string | null;
  text: string;
  executionId: number;
  actionIndex: number;
  eventKey: string;
}) {
  const [connector] = await db.select().from(integrationConnectors).where(and(
    eq(integrationConnectors.id, input.connectorId),
    eq(integrationConnectors.organizationId, input.organizationId),
    eq(integrationConnectors.provider, "slack"),
    eq(integrationConnectors.active, true),
  )).limit(1);
  if (!connector) throw new Error("Slack connector was not found or is disabled.");

  const config = normalizeSlackConnectorConfig(connector.config);
  if (!config) throw new Error("Slack connector configuration is invalid.");

  const channelId = String(input.channelId ?? config.defaultChannelId).trim();
  if (!config.allowedChannelIds.includes(channelId)) {
    throw new Error("Slack channel is not allow-listed on this connector.");
  }

  const existingRows = await db.select().from(integrationConnectorDeliveries).where(and(
    eq(integrationConnectorDeliveries.connectorId, connector.id),
    eq(integrationConnectorDeliveries.automationExecutionId, input.executionId),
    eq(integrationConnectorDeliveries.actionIndex, input.actionIndex),
  )).limit(1);
  const existing = existingRows[0];
  if (existing?.status === "succeeded") {
    return {
      connectorId: connector.id,
      deliveryId: existing.id,
      channelId: existing.providerChannelId ?? channelId,
      messageId: existing.providerMessageId ?? "",
      idempotent: true,
    };
  }
  if (existing?.status === "pending") {
    throw new Error("Slack delivery for this automation step is already in progress.");
  }

  let delivery = existing;
  if (existing?.status === "failed") {
    const [claimed] = await db.update(integrationConnectorDeliveries).set({
      status: "pending",
      error: null,
    }).where(and(
      eq(integrationConnectorDeliveries.id, existing.id),
      eq(integrationConnectorDeliveries.status, "failed"),
    )).returning();
    if (!claimed) throw new Error("Slack delivery retry was claimed by another worker.");
    delivery = claimed;
  } else {
    const [claimed] = await db.insert(integrationConnectorDeliveries).values({
      organizationId: input.organizationId,
      connectorId: connector.id,
      automationExecutionId: input.executionId,
      actionIndex: input.actionIndex,
      eventKey: input.eventKey.slice(0, 240),
      destination: channelId,
      status: "pending",
    }).onConflictDoNothing().returning();
    if (!claimed) {
      const [concurrent] = await db.select().from(integrationConnectorDeliveries).where(and(
        eq(integrationConnectorDeliveries.connectorId, connector.id),
        eq(integrationConnectorDeliveries.automationExecutionId, input.executionId),
        eq(integrationConnectorDeliveries.actionIndex, input.actionIndex),
      )).limit(1);
      if (concurrent?.status === "succeeded") {
        return {
          connectorId: connector.id,
          deliveryId: concurrent.id,
          channelId: concurrent.providerChannelId ?? channelId,
          messageId: concurrent.providerMessageId ?? "",
          idempotent: true,
        };
      }
      throw new Error("Slack delivery for this automation step is already in progress.");
    }
    delivery = claimed;
  }

  try {
    const token = decryptIntegrationCredential(connector.credentialCiphertext);
    const sent = await sendSlackConnectorMessage({ token, channelId, text: input.text });
    const [completed] = await db.update(integrationConnectorDeliveries).set({
      status: "succeeded",
      providerMessageId: sent.messageId,
      providerChannelId: sent.channelId,
      deliveredAt: new Date(),
      error: null,
    }).where(and(
      eq(integrationConnectorDeliveries.id, delivery.id),
      eq(integrationConnectorDeliveries.status, "pending"),
    )).returning();

    await recordAuditEvent({
      organizationId: input.organizationId,
      actor: "Automation Studio",
      action: "Slack connector message delivered",
      resource: connector.name,
      metadata: {
        connectorId: connector.id,
        deliveryId: delivery.id,
        automationExecutionId: input.executionId,
        actionIndex: input.actionIndex,
        eventKey: input.eventKey,
        channelId: sent.channelId,
        providerMessageId: sent.messageId,
      },
    });

    return {
      connectorId: connector.id,
      deliveryId: completed?.id ?? delivery.id,
      channelId: sent.channelId,
      messageId: sent.messageId,
      idempotent: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 2000) : "Slack delivery failed.";
    await db.update(integrationConnectorDeliveries).set({
      status: "failed",
      error: message,
    }).where(eq(integrationConnectorDeliveries.id, delivery.id));

    await recordAuditEvent({
      organizationId: input.organizationId,
      actor: "Automation Studio",
      action: "Slack connector delivery failed",
      resource: connector.name,
      metadata: {
        connectorId: connector.id,
        deliveryId: delivery.id,
        automationExecutionId: input.executionId,
        actionIndex: input.actionIndex,
        eventKey: input.eventKey,
        channelId,
        error: message,
      },
    });
    throw new Error(message);
  }
}
