import { and, desc, eq, inArray, sql } from "drizzle-orm";
import nodemailer from "nodemailer";
import { db } from "@/db";
import { outbox } from "@/db/schema";
import { activeMailProvider as detectProvider, deliveryCapable as capable, type MailProvider } from "@/lib/mail-provider";
import { nextBackoffMs } from "@/lib/webhook-backoff";

export { activeMailProvider, deliveryCapable } from "@/lib/mail-provider";
export type { MailProvider } from "@/lib/mail-provider";

const provider = (): MailProvider => detectProvider();
const capableHere = () => capable();

const SENSITIVE_LINK_PURPOSES = new Set([
  "password-reset",
  "invitation",
  "email-change-verification",
]);

export function isSensitiveMailPurpose(purpose: string) {
  return SENSITIVE_LINK_PURPOSES.has(purpose);
}

function maxAttemptsForPurpose(purpose: string) {
  // One-time links are intentionally never auto-retried after an attempted
  // delivery because their body is redacted immediately after the first try.
  return isSensitiveMailPurpose(purpose) ? 1 : 5;
}

function storedBodyAfterAttempt(purpose: string, body: string) {
  return isSensitiveMailPurpose(purpose)
    ? "[redacted after delivery attempt: sensitive one-time link removed]"
    : body;
}

type DeliveryOutcome =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; error: string; providerMessageId?: null };

async function deliver(providerName: MailProvider, row: typeof outbox.$inferSelect): Promise<DeliveryOutcome> {
  if (row.channel !== "email") {
    return { ok: false, error: `Channel ${row.channel} has no configured delivery adapter.` };
  }

  if (providerName === "resend") {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM ?? "Linaw <no-reply@linaw.ph>",
        to: [row.recipient],
        subject: row.subject,
        text: row.body,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    return response.ok
      ? { ok: true, providerMessageId: typeof payload?.id === "string" ? payload.id : null }
      : { ok: false, error: payload?.message ?? `Resend HTTP ${response.status}` };
  }

  if (providerName === "postmark") {
    const response = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "X-Postmark-Server-Token": process.env.POSTMARK_SERVER_TOKEN as string,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        From: process.env.MAIL_FROM ?? "no-reply@linaw.ph",
        To: row.recipient,
        Subject: row.subject,
        TextBody: row.body,
        MessageStream: "outbound",
      }),
    });
    const payload = await response.json().catch(() => ({}));
    return response.ok
      ? {
          ok: true,
          providerMessageId:
            typeof payload?.MessageID === "string"
              ? payload.MessageID
              : typeof payload?.MessageId === "string"
                ? payload.MessageId
                : null,
        }
      : { ok: false, error: payload?.Message ?? `Postmark HTTP ${response.status}` };
  }

  if (providerName === "smtp") {
    const url = process.env.SMTP_URL;
    if (!url) return { ok: false, error: "SMTP_URL is not configured." };
    try {
      const transport = nodemailer.createTransport(url);
      const info = await transport.sendMail({
        from: process.env.MAIL_FROM ?? "Linaw <no-reply@linaw.ph>",
        to: row.recipient,
        subject: row.subject,
        text: row.body,
      });
      return {
        ok: true,
        providerMessageId: typeof info.messageId === "string" ? info.messageId : null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "SMTP send failed";
      return { ok: false, error: `SMTP: ${message}` };
    }
  }

  return { ok: false, error: `Provider ${providerName} is not implemented.` };
}

export type OutboxAttemptResult = {
  id: number;
  status: "queued" | "sent" | "failed" | "busy";
  delivered: boolean;
  queued: boolean;
  provider: MailProvider;
  attempts: number;
  reason: string | null;
  providerMessageId: string | null;
  nextAttemptAt: Date | null;
};

export async function attemptOutboxDelivery(id: number): Promise<OutboxAttemptResult> {
  const [existing] = await db.select().from(outbox).where(eq(outbox.id, id)).limit(1);
  if (!existing) throw new Error("Outbox message not found.");

  if (existing.status === "sent") {
    return {
      id,
      status: "sent",
      delivered: true,
      queued: false,
      provider: existing.provider as MailProvider,
      attempts: existing.attempts,
      reason: null,
      providerMessageId: existing.providerMessageId,
      nextAttemptAt: null,
    };
  }

  const providerName = existing.channel === "email" ? provider() : "none";
  if (providerName === "none") {
    await db.update(outbox).set({
      status: "queued",
      provider: "none",
      nextAttemptAt: null,
    }).where(eq(outbox.id, id));
    return {
      id,
      status: "queued",
      delivered: false,
      queued: true,
      provider: "none",
      attempts: existing.attempts,
      reason: existing.channel === "email"
        ? "No email provider configured (set RESEND_API_KEY, POSTMARK_SERVER_TOKEN, or SMTP_URL)."
        : `No delivery adapter is configured for channel ${existing.channel}.`,
      providerMessageId: null,
      nextAttemptAt: null,
    };
  }

  const [claimed] = await db.update(outbox).set({
    status: "in_flight",
    provider: providerName,
    nextAttemptAt: null,
  }).where(and(
    eq(outbox.id, id),
    inArray(outbox.status, ["queued", "pending", "failed"]),
  )).returning();

  if (!claimed) {
    const [current] = await db.select().from(outbox).where(eq(outbox.id, id)).limit(1);
    return {
      id,
      status: current?.status === "sent" ? "sent" : "busy",
      delivered: current?.status === "sent",
      queued: false,
      provider: (current?.provider ?? providerName) as MailProvider,
      attempts: current?.attempts ?? existing.attempts,
      reason: current?.status === "in_flight" ? "Delivery is already in progress." : "Message state changed before delivery could be claimed.",
      providerMessageId: current?.providerMessageId ?? null,
      nextAttemptAt: current?.nextAttemptAt ?? null,
    };
  }

  const attempts = claimed.attempts + 1;
  const attemptedAt = new Date();
  let outcome: DeliveryOutcome;
  try {
    outcome = await deliver(providerName, claimed);
  } catch (error) {
    outcome = { ok: false, error: error instanceof Error ? error.message : "delivery error" };
  }

  if (outcome.ok) {
    await db.update(outbox).set({
      status: "sent",
      attempts,
      lastAttemptAt: attemptedAt,
      nextAttemptAt: null,
      sentAt: attemptedAt,
      error: null,
      provider: providerName,
      providerMessageId: outcome.providerMessageId,
      body: storedBodyAfterAttempt(claimed.purpose, claimed.body),
    }).where(eq(outbox.id, id));

    return {
      id,
      status: "sent",
      delivered: true,
      queued: false,
      provider: providerName,
      attempts,
      reason: null,
      providerMessageId: outcome.providerMessageId,
      nextAttemptAt: null,
    };
  }

  const exhausted = attempts >= claimed.maxAttempts;
  const nextAttemptAt = exhausted ? null : new Date(Date.now() + nextBackoffMs(attempts));
  await db.update(outbox).set({
    status: "failed",
    attempts,
    lastAttemptAt: attemptedAt,
    nextAttemptAt,
    sentAt: null,
    error: outcome.error,
    provider: providerName,
    providerMessageId: null,
    body: storedBodyAfterAttempt(claimed.purpose, claimed.body),
  }).where(eq(outbox.id, id));

  return {
    id,
    status: "failed",
    delivered: false,
    queued: false,
    provider: providerName,
    attempts,
    reason: outcome.error,
    providerMessageId: null,
    nextAttemptAt,
  };
}

/**
 * Queues a message, then makes one immediate delivery attempt when an email
 * provider is configured. Failed non-sensitive notices enter bounded retry
 * backoff. Sensitive one-time links stop after the first failed attempt and
 * must be regenerated instead of replayed from storage.
 */
export async function queueMessage(input: {
  organizationId?: number | null;
  channel?: "email" | "sms";
  recipient: string;
  subject: string;
  body: string;
  purpose: string;
  metadata?: Record<string, unknown>;
}) {
  const channel = input.channel ?? "email";
  const providerName = channel === "email" ? provider() : "none";
  const [row] = await db.insert(outbox).values({
    organizationId: input.organizationId ?? null,
    channel,
    recipient: input.recipient,
    subject: input.subject,
    body: input.body,
    purpose: input.purpose,
    metadata: input.metadata ?? {},
    provider: providerName,
    status: providerName === "none" ? "queued" : "pending",
    attempts: 0,
    maxAttempts: maxAttemptsForPurpose(input.purpose),
  }).returning();

  if (providerName === "none") {
    return {
      delivered: false,
      queued: true,
      provider: providerName,
      id: row.id,
      status: "queued" as const,
      attempts: 0,
      reason: channel === "email"
        ? "No email provider configured (set RESEND_API_KEY, POSTMARK_SERVER_TOKEN, or SMTP_URL)."
        : `No delivery adapter is configured for channel ${channel}.`,
    };
  }

  return attemptOutboxDelivery(row.id);
}

/**
 * Claims queued messages after a provider is connected and failed messages
 * whose retry backoff is due. SKIP LOCKED prevents duplicate sends when more
 * than one worker is running.
 */
export async function drainOutboxRetries(limit = 25) {
  if (!capableHere()) return [];

  const claimed = await db.execute(sql`
    with due as (
      select id from ${outbox}
      where channel = 'email'
        and (
          (status = 'queued' and attempts = 0)
          or (
            status = 'failed'
            and attempts < max_attempts
            and next_attempt_at is not null
            and next_attempt_at <= now()
          )
        )
      order by coalesce(next_attempt_at, created_at) asc, id asc
      limit ${limit}
      for update skip locked
    )
    update ${outbox} o
    set status = 'pending'
    from due
    where o.id = due.id
    returning o.id
  `);

  const ids = (claimed.rows as Array<{ id: number }>).map((row) => row.id);
  const results: OutboxAttemptResult[] = [];
  for (const id of ids) {
    results.push(await attemptOutboxDelivery(id));
  }
  return results;
}

export async function retryOutboxMessage(id: number, organizationId: number) {
  const [row] = await db.select().from(outbox).where(and(
    eq(outbox.id, id),
    eq(outbox.organizationId, organizationId),
  )).limit(1);

  if (!row) throw new Error("Outbox message not found for this workspace.");
  if (row.status === "sent") throw new Error("This message is already sent and will not be duplicated.");
  if (row.status === "in_flight" || row.status === "pending") {
    throw new Error("This message is already being delivered.");
  }
  if (isSensitiveMailPurpose(row.purpose) && row.attempts > 0) {
    throw new Error("This one-time-link email cannot be retried. Generate a fresh reset, invitation, or verification message.");
  }
  if (!capableHere()) {
    throw new Error("No email provider is configured. The message remains queued.");
  }

  await db.update(outbox).set({
    status: "pending",
    nextAttemptAt: null,
    maxAttempts: Math.max(row.maxAttempts, row.attempts + 1),
    error: null,
  }).where(and(eq(outbox.id, id), eq(outbox.organizationId, organizationId)));

  return attemptOutboxDelivery(id);
}

export function outboxDisplayStatus(
  row: Pick<typeof outbox.$inferSelect, "status" | "attempts" | "sentAt">,
): "queued" | "sending" | "sent" | "retried" | "failed" {
  if (row.status === "sent") return row.attempts > 1 ? "retried" : "sent";
  if (row.status === "in_flight" || row.status === "pending") return "sending";
  if (row.status === "failed") return "failed";
  return "queued";
}

export async function recentOutbox(limit = 50, organizationId?: number) {
  if (Number.isInteger(organizationId)) {
    return db
      .select()
      .from(outbox)
      .where(eq(outbox.organizationId, organizationId as number))
      .orderBy(desc(outbox.id))
      .limit(limit);
  }
  return db.select().from(outbox).orderBy(desc(outbox.id)).limit(limit);
}

export async function outboxDeliverySummary(organizationId: number) {
  const rows = await recentOutbox(200, organizationId);
  const summary = {
    queued: 0,
    sending: 0,
    sent: 0,
    retried: 0,
    failed: 0,
    retryScheduled: 0,
  };
  for (const row of rows) {
    const display = outboxDisplayStatus(row);
    summary[display] += 1;
    if (row.status === "failed" && row.nextAttemptAt) summary.retryScheduled += 1;
  }
  return summary;
}
