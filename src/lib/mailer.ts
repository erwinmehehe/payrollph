import { and, desc, eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import { db } from "@/db";
import { outbox } from "@/db/schema";

import { activeMailProvider as detectProvider, deliveryCapable as capable, type MailProvider } from "@/lib/mail-provider";

export { activeMailProvider, deliveryCapable } from "@/lib/mail-provider";
export type { MailProvider } from "@/lib/mail-provider";

const provider = (): MailProvider => detectProvider();
const capableHere = () => capable();

/**
 * Queues a message and attempts real delivery only when a provider is
 * configured. With no provider the row stays `queued` and is visible in the
 * admin outbox, it is never reported as sent.
 */
export async function queueMessage(input: {
  organizationId?: number | null;
  channel?: "email" | "sms";
  recipient: string;
  subject: string;
  body: string;
  purpose: string;
}) {
  const providerName = provider();
  const [row] = await db.insert(outbox).values({
    organizationId: input.organizationId ?? null,
    channel: input.channel ?? "email",
    recipient: input.recipient,
    subject: input.subject,
    body: input.body,
    purpose: input.purpose,
    provider: providerName,
    status: providerName === "none" ? "queued" : "pending",
  }).returning();

  if (providerName === "none") {
    return { delivered: false, queued: true, provider: providerName, id: row.id, reason: "No email provider configured (set RESEND_API_KEY, POSTMARK_SERVER_TOKEN, or SMTP_URL)." };
  }

  try {
    const response = await deliver(providerName, row);
    await db.update(outbox).set({
      status: response.ok ? "sent" : "failed",
      sentAt: response.ok ? new Date() : null,
      error: response.ok ? null : response.error,
    }).where(eq(outbox.id, row.id));
    return { delivered: response.ok, queued: false, provider: providerName, id: row.id, reason: response.ok ? null : response.error };
  } catch (error) {
    const message = error instanceof Error ? error.message : "delivery error";
    await db.update(outbox).set({ status: "failed", error: message }).where(eq(outbox.id, row.id));
    return { delivered: false, queued: false, provider: providerName, id: row.id, reason: message };
  }
}

export async function queueMessageOnce(input: {
  organizationId: number;
  channel?: "email" | "sms";
  recipient: string;
  subject: string;
  body: string;
  purpose: string;
}) {
  const [existing] = await db
    .select({
      id: outbox.id,
      status: outbox.status,
      provider: outbox.provider,
    })
    .from(outbox)
    .where(and(
      eq(outbox.organizationId, input.organizationId),
      eq(outbox.recipient, input.recipient),
      eq(outbox.purpose, input.purpose),
    ))
    .limit(1);

  if (existing) {
    return {
      delivered: existing.status === "sent",
      queued: existing.status === "queued" || existing.status === "pending",
      provider: existing.provider as MailProvider,
      id: existing.id,
      reason: existing.status === "failed" ? "A previous notification attempt failed." : null,
      duplicate: true,
    };
  }

  const result = await queueMessage(input);
  return { ...result, duplicate: false };
}

export async function retryOutboxMessage(input: {
  organizationId: number;
  messageId: number;
}) {
  const [row] = await db
    .select()
    .from(outbox)
    .where(and(
      eq(outbox.id, input.messageId),
      eq(outbox.organizationId, input.organizationId),
    ))
    .limit(1);

  if (!row) return null;

  if (row.status === "sent") {
    return {
      id: row.id,
      status: row.status,
      delivered: true,
      queued: false,
      provider: row.provider as MailProvider,
      alreadySent: true,
      reason: null,
    };
  }

  const providerName = provider();
  if (providerName === "none") {
    await db.update(outbox).set({
      provider: providerName,
      status: "queued",
      error: null,
    }).where(eq(outbox.id, row.id));

    return {
      id: row.id,
      status: "queued",
      delivered: false,
      queued: true,
      provider: providerName,
      alreadySent: false,
      reason: "No email provider configured (set RESEND_API_KEY, POSTMARK_SERVER_TOKEN, or SMTP_URL).",
    };
  }

  await db.update(outbox).set({
    provider: providerName,
    status: "pending",
    error: null,
  }).where(eq(outbox.id, row.id));

  try {
    const response = await deliver(providerName, { ...row, provider: providerName, status: "pending", error: null });
    await db.update(outbox).set({
      status: response.ok ? "sent" : "failed",
      sentAt: response.ok ? new Date() : null,
      error: response.ok ? null : response.error,
    }).where(eq(outbox.id, row.id));

    return {
      id: row.id,
      status: response.ok ? "sent" : "failed",
      delivered: response.ok,
      queued: false,
      provider: providerName,
      alreadySent: false,
      reason: response.ok ? null : response.error,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "delivery error";
    await db.update(outbox).set({
      status: "failed",
      error: message,
    }).where(eq(outbox.id, row.id));
    return {
      id: row.id,
      status: "failed",
      delivered: false,
      queued: false,
      provider: providerName,
      alreadySent: false,
      reason: message,
    };
  }
}

async function deliver(provider: MailProvider, row: typeof outbox.$inferSelect) {
  if (provider === "resend") {
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
    return response.ok ? { ok: true } : { ok: false, error: `Resend HTTP ${response.status}` };
  }

  if (provider === "postmark") {
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
    return response.ok ? { ok: true } : { ok: false, error: `Postmark HTTP ${response.status}` };
  }

  if (provider === "smtp") {
    const url = process.env.SMTP_URL;
    if (!url) return { ok: false, error: "SMTP_URL is not configured." };
    try {
      const transport = nodemailer.createTransport(url);
      await transport.sendMail({
        from: process.env.MAIL_FROM ?? "Linaw <no-reply@linaw.ph>",
        to: row.recipient,
        subject: row.subject,
        text: row.body,
      });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "SMTP send failed";
      return { ok: false, error: `SMTP: ${message}` };
    }
  }

  return { ok: false, error: `Provider ${provider} is not implemented.` };
}

export async function recentOutbox(limit = 25, organizationId?: number) {
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
