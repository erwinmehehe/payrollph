import { and, eq, isNotNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { webhookDeliveries, webhookEndpoints } from "@/db/schema";
import { signWebhookPayload, type WebhookEvent } from "@/lib/webhook-signing";
import { nextBackoffMs } from "@/lib/webhook-backoff";
import { validateWebhookTarget } from "@/lib/security-network";

export { signWebhookPayload, verifyWebhookSignature, WEBHOOK_EVENTS } from "@/lib/webhook-signing";
export type { WebhookEvent } from "@/lib/webhook-signing";

export { BACKOFF_SCHEDULE_MS, nextBackoffMs } from "@/lib/webhook-backoff";

async function attemptDelivery(delivery: {
  id: number;
  event: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
}, endpoint: { url: string; secret: string }) {
  const body = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signWebhookPayload(endpoint.secret, body, timestamp);
  const attempts = delivery.attempts + 1;

  try {
    // Re-validate at send time as well as creation time. DNS and endpoint
    // configuration can change after the webhook is stored.
    const targetUrl = await validateWebhookTarget(endpoint.url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Linaw-Signature": signature,
        "Linaw-Event": delivery.event,
        "Linaw-Attempt": String(attempts),
      },
      body,
      signal: controller.signal,
      redirect: "manual",
    });
    clearTimeout(timer);

    if (response.ok) {
      await db.update(webhookDeliveries).set({
        status: "delivered",
        responseCode: response.status,
        attempts,
        signature,
        nextAttemptAt: null,
        deliveredAt: new Date(),
        error: null,
      }).where(eq(webhookDeliveries.id, delivery.id));
      return { status: "delivered" as const, code: response.status, attempts };
    }

    const exhausted = attempts >= delivery.maxAttempts;
    await db.update(webhookDeliveries).set({
      status: exhausted ? "exhausted" : "retrying",
      responseCode: response.status,
      attempts,
      signature,
      error: `HTTP ${response.status}`,
      nextAttemptAt: exhausted ? null : new Date(Date.now() + nextBackoffMs(attempts)),
    }).where(eq(webhookDeliveries.id, delivery.id));
    return { status: exhausted ? ("exhausted" as const) : ("retrying" as const), code: response.status, attempts };
  } catch (error) {
    const message = error instanceof Error ? error.message : "delivery failed";
    const exhausted = attempts >= delivery.maxAttempts;
    await db.update(webhookDeliveries).set({
      status: exhausted ? "exhausted" : "retrying",
      attempts,
      signature,
      error: message,
      nextAttemptAt: exhausted ? null : new Date(Date.now() + nextBackoffMs(attempts)),
    }).where(eq(webhookDeliveries.id, delivery.id));
    return { status: exhausted ? ("exhausted" as const) : ("retrying" as const), error: message, attempts };
  }
}

export async function dispatchWebhook(input: {
  organizationId: number;
  event: WebhookEvent;
  data: Record<string, unknown>;
}) {
  const endpoints = await db.select().from(webhookEndpoints).where(and(
    eq(webhookEndpoints.organizationId, input.organizationId),
    eq(webhookEndpoints.active, true),
  ));

  const subscribed = endpoints.filter((endpoint) => {
    const events = Array.isArray(endpoint.events) ? (endpoint.events as string[]) : [];
    return events.length === 0 || events.includes(input.event);
  });

  const results = [];
  for (const endpoint of subscribed) {
    const payload = {
      id: `evt_${Date.now()}_${endpoint.id}`,
      event: input.event,
      createdAt: new Date().toISOString(),
      organizationId: input.organizationId,
      data: input.data,
    };

    const [delivery] = await db.insert(webhookDeliveries).values({
      endpointId: endpoint.id,
      organizationId: input.organizationId,
      event: input.event,
      payload,
      signature: "",
      status: "pending",
      attempts: 0,
      maxAttempts: 5,
    }).returning();

    const outcome = await attemptDelivery(
      { id: delivery.id, event: input.event, payload, attempts: 0, maxAttempts: delivery.maxAttempts },
      endpoint,
    );
    results.push({ endpointId: endpoint.id, deliveryId: delivery.id, ...outcome });
  }

  return results;
}

/**
 * Claims due retries with FOR UPDATE SKIP LOCKED so multiple workers can drain
 * the queue concurrently without double-sending.
 */
export async function drainWebhookRetries(limit = 20) {
  const claimed = await db.execute(sql`
    with due as (
      select id from ${webhookDeliveries}
      where status = 'retrying'
        and next_attempt_at is not null
        and next_attempt_at <= now()
      order by next_attempt_at asc
      limit ${limit}
      for update skip locked
    )
    update ${webhookDeliveries} d
    set status = 'in_flight'
    from due
    where d.id = due.id
    returning d.id
  `);

  const ids = (claimed.rows as Array<{ id: number }>).map((row) => row.id);
  if (ids.length === 0) return [];

  const results = [];
  for (const id of ids) {
    const [delivery] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id));
    if (!delivery) continue;
    const [endpoint] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, delivery.endpointId));
    if (!endpoint) {
      await db.update(webhookDeliveries).set({ status: "exhausted", error: "endpoint removed", nextAttemptAt: null }).where(eq(webhookDeliveries.id, id));
      continue;
    }
    const outcome = await attemptDelivery(delivery, endpoint);
    results.push({ deliveryId: id, ...outcome });
  }
  return results;
}

export async function pendingRetryCount(organizationId: number) {
  const rows = await db.select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(and(
      eq(webhookDeliveries.organizationId, organizationId),
      or(eq(webhookDeliveries.status, "retrying"), eq(webhookDeliveries.status, "in_flight")),
      isNotNull(webhookDeliveries.nextAttemptAt),
      lte(webhookDeliveries.nextAttemptAt, new Date(Date.now() + 86_400_000)),
    ));
  return rows.length;
}
