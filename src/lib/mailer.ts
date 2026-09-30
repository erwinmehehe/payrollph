import { and, asc, desc, eq, inArray, lt, lte, or } from "drizzle-orm";
import nodemailer from "nodemailer";
import { db } from "@/db";
import { outbox } from "@/db/schema";
import { ensureCoreCompatibilitySchema } from "@/lib/core-schema-compat";

import { activeMailProvider as detectProvider, deliveryCapable as capable, type MailProvider } from "@/lib/mail-provider";

export { activeMailProvider, deliveryCapable } from "@/lib/mail-provider";
export type { MailProvider } from "@/lib/mail-provider";

const provider = (): MailProvider => detectProvider();
const capableHere = () => capable();

const SENSITIVE_LINK_PURPOSES = new Set([
  "password-reset",
  "invitation",
  "email-change-verification",
]);

const MAX_AUTO_ATTEMPTS = 5;

function storedBodyAfterAttempt(purpose: string, body: string) {
  return SENSITIVE_LINK_PURPOSES.has(purpose)
    ? "[redacted after delivery attempt: sensitive one-time link removed]"
    : body;
}

function retryDelayMs(attemptCount: number) {
  const schedule = [
    5 * 60_000,
    30 * 60_000,
    2 * 60 * 60_000,
    6 * 60 * 60_000,
    24 * 60 * 60_000,
  ];
  return schedule[Math.min(Math.max(attemptCount - 1, 0), schedule.length - 1)];
}

function retryAt(attemptCount: number) {
  return new Date(Date.now() + retryDelayMs(attemptCount));
}

type DeliveryResult = {
  ok: boolean;
  error?: string;
  providerMessageId?: string | null;
};

async function deliver(providerName: MailProvider, row: typeof outbox.$inferSelect): Promise<DeliveryResult> {
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
      ? { ok: true, providerMessageId: typeof payload?.MessageID === "string" ? payload.MessageID : null }
      : { ok: false, error: payload?.Message ?? `Postmark HTTP ${response.status}` };
  }

  if (providerName === "smtp") {
    const url = process.env.SMTP_URL;
    if (!url) return { ok: false, error: "SMTP_URL is not configured." };
    try {
      const transport = nodemailer.createTransport(url);
      const result = await transport.sendMail({
        from: process.env.MAIL_FROM ?? "Linaw <no-reply@linaw.ph>",
        to: row.recipient,
        subject: row.subject,
        text: row.body,
      });
      return {
        ok: true,
        providerMessageId: typeof result.messageId === "string" ? result.messageId : null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "SMTP send failed";
      return { ok: false, error: `SMTP: ${message}` };
    }
  }

  return { ok: false, error: `Provider ${providerName} is not implemented.` };
}

/**
 * Atomically claims one queued/failed message before delivery. A second worker
 * or operator cannot send the same row while its status is "sending".
 */
export async function attemptOutboxDelivery(id: number) {
  await ensureCoreCompatibilitySchema();
  const [existing] = await db.select().from(outbox).where(eq(outbox.id, id)).limit(1);
  if (!existing) return { delivered: false, queued: false, id, reason: "Outbox message not found." };
  if (existing.status === "sent") {
    return {
      delivered: true,
      queued: false,
      provider: existing.provider as MailProvider,
      id,
      reason: null,
      alreadySent: true,
      providerMessageId: existing.providerMessageId,
    };
  }
  if (existing.status === "sending") {
    return {
      delivered: false,
      queued: false,
      provider: existing.provider as MailProvider,
      id,
      reason: "Delivery is already in progress.",
    };
  }
  if (SENSITIVE_LINK_PURPOSES.has(existing.purpose) && existing.body.startsWith("[redacted after delivery attempt:")) {
    return {
      delivered: false,
      queued: false,
      provider: existing.provider as MailProvider,
      id,
      reason: "This sensitive one-time-link message cannot be retried after its body was redacted.",
    };
  }

  const providerName = provider();
  if (providerName === "none") {
    await db.update(outbox).set({
      provider: "none",
      status: "queued",
      nextAttemptAt: null,
      error: "No email provider configured (set RESEND_API_KEY, POSTMARK_SERVER_TOKEN, or SMTP_URL).",
    }).where(and(eq(outbox.id, id), inArray(outbox.status, ["queued", "failed"])));
    return {
      delivered: false,
      queued: true,
      provider: providerName,
      id,
      reason: "No email provider configured (set RESEND_API_KEY, POSTMARK_SERVER_TOKEN, or SMTP_URL).",
    };
  }

  const attemptedAt = new Date();
  const attemptCount = existing.attemptCount + 1;
  const [claimed] = await db.update(outbox).set({
    status: "sending",
    provider: providerName,
    attemptCount,
    lastAttemptAt: attemptedAt,
    nextAttemptAt: null,
    error: null,
  }).where(and(
    eq(outbox.id, id),
    inArray(outbox.status, ["queued", "failed"]),
  )).returning();

  if (!claimed) {
    const [current] = await db.select().from(outbox).where(eq(outbox.id, id)).limit(1);
    return {
      delivered: current?.status === "sent",
      queued: current?.status === "queued",
      provider: (current?.provider ?? providerName) as MailProvider,
      id,
      reason: current?.status === "sending" ? "Delivery is already in progress." : current?.error ?? "Message state changed before delivery.",
      providerMessageId: current?.providerMessageId ?? null,
    };
  }

  try {
    const response = await deliver(providerName, claimed);
    const body = storedBodyAfterAttempt(claimed.purpose, claimed.body);
    if (response.ok) {
      await db.update(outbox).set({
        status: "sent",
        sentAt: new Date(),
        providerMessageId: response.providerMessageId ?? null,
        nextAttemptAt: null,
        error: null,
        body,
      }).where(and(eq(outbox.id, id), eq(outbox.status, "sending")));
      return {
        delivered: true,
        queued: false,
        provider: providerName,
        id,
        reason: null,
        providerMessageId: response.providerMessageId ?? null,
        attemptCount,
      };
    }

    const error = response.error ?? "Delivery failed.";
    await db.update(outbox).set({
      status: "failed",
      error,
      nextAttemptAt: attemptCount < MAX_AUTO_ATTEMPTS ? retryAt(attemptCount) : null,
      body,
    }).where(and(eq(outbox.id, id), eq(outbox.status, "sending")));
    return {
      delivered: false,
      queued: false,
      provider: providerName,
      id,
      reason: error,
      providerMessageId: null,
      attemptCount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "delivery error";
    await db.update(outbox).set({
      status: "failed",
      error: message,
      nextAttemptAt: attemptCount < MAX_AUTO_ATTEMPTS ? retryAt(attemptCount) : null,
      body: storedBodyAfterAttempt(claimed.purpose, claimed.body),
    }).where(and(eq(outbox.id, id), eq(outbox.status, "sending")));
    return {
      delivered: false,
      queued: false,
      provider: providerName,
      id,
      reason: message,
      providerMessageId: null,
      attemptCount,
    };
  }
}

/**
 * Creates the durable row first, then attempts delivery. A process crash can
 * leave a queued row, but never loses the notification entirely.
 */
export async function queueMessage(input: {
  organizationId?: number | null;
  payrollRunId?: number | null;
  employeeId?: number | null;
  channel?: "email" | "sms";
  recipient: string;
  subject: string;
  body: string;
  purpose: string;
}) {
  await ensureCoreCompatibilitySchema();
  const providerName = provider();
  const [row] = await db.insert(outbox).values({
    organizationId: input.organizationId ?? null,
    payrollRunId: input.payrollRunId ?? null,
    employeeId: input.employeeId ?? null,
    channel: input.channel ?? "email",
    recipient: input.recipient,
    subject: input.subject,
    body: input.body,
    purpose: input.purpose,
    provider: providerName,
    status: "queued",
    attemptCount: 0,
  }).returning();

  return attemptOutboxDelivery(row.id);
}

export async function retryOutboxMessage(id: number, organizationId: number) {
  await ensureCoreCompatibilitySchema();
  const [row] = await db.select().from(outbox).where(and(
    eq(outbox.id, id),
    eq(outbox.organizationId, organizationId),
  )).limit(1);
  if (!row) throw new Error("Outbox message not found in this workspace.");
  if (row.status === "sent") throw new Error("This message is already sent.");
  if (row.status === "sending") throw new Error("This message is already being delivered.");
  return attemptOutboxDelivery(row.id);
}

export async function retryPayrollRunOutbox(organizationId: number, payrollRunId: number) {
  await ensureCoreCompatibilitySchema();
  const rows = await db.select().from(outbox).where(and(
    eq(outbox.organizationId, organizationId),
    eq(outbox.payrollRunId, payrollRunId),
    inArray(outbox.status, ["queued", "failed"]),
  )).orderBy(outbox.id);

  const results = [];
  for (const row of rows) {
    results.push(await attemptOutboxDelivery(row.id));
  }
  return results;
}

export async function drainDueOutboxRetries(limit = 25) {
  await ensureCoreCompatibilitySchema();
  if (!capableHere()) {
    return { attempted: 0, sent: 0, failed: 0, skipped: "no-provider" as const, results: [] };
  }

  const now = new Date();
  const rows = await db.select().from(outbox).where(
    and(
      eq(outbox.channel, "email"),
      lt(outbox.attemptCount, MAX_AUTO_ATTEMPTS),
      or(
        eq(outbox.status, "queued"),
        and(eq(outbox.status, "failed"), lte(outbox.nextAttemptAt, now)),
      ),
    ),
  ).orderBy(asc(outbox.id)).limit(limit);

  const results = [];
  for (const row of rows) {
    const result = await attemptOutboxDelivery(row.id);
    results.push(result);
  }

  return {
    attempted: results.length,
    sent: results.filter((result) => result.delivered).length,
    failed: results.filter((result) => !result.delivered && !result.queued).length,
    skipped: null,
    results,
  };
}

export async function payrollRunOutboxHealth(organizationId: number, payrollRunId: number) {
  await ensureCoreCompatibilitySchema();
  const rows = await db.select().from(outbox).where(and(
    eq(outbox.organizationId, organizationId),
    eq(outbox.payrollRunId, payrollRunId),
  )).orderBy(desc(outbox.id));

  const sent = rows.filter((row) => row.status === "sent").length;
  const failed = rows.filter((row) => row.status === "failed").length;
  const queued = rows.filter((row) => row.status === "queued").length;
  const sending = rows.filter((row) => row.status === "sending").length;

  return {
    total: rows.length,
    sent,
    failed,
    queued,
    sending,
    healthy: rows.length > 0 && sent === rows.length,
    messages: rows,
  };
}

export async function recentOutbox(limit = 25, organizationId?: number) {
  await ensureCoreCompatibilitySchema();
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
