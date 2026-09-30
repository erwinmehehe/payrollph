import { and, asc, desc, eq, inArray } from "drizzle-orm";
import nodemailer from "nodemailer";
import { db } from "@/db";
import { auditEvents, outbox } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { activeMailProvider as detectProvider, deliveryCapable as capable, type MailProvider } from "@/lib/mail-provider";
import { ensureOutboxDeliverySchema } from "@/lib/outbox-schema";

export { activeMailProvider, deliveryCapable } from "@/lib/mail-provider";
export type { MailProvider } from "@/lib/mail-provider";

const provider = (): MailProvider => detectProvider();
const capableHere = () => capable();

const SENSITIVE_LINK_PURPOSES = new Set([
  "password-reset",
  "invitation",
  "email-change-verification",
]);

const MAX_AUTOMATIC_RETRIES = 3;
const AUTO_RETRY_DELAYS_MS = [
  5 * 60 * 1000,
  30 * 60 * 1000,
  2 * 60 * 60 * 1000,
];

type OutboxRow = typeof outbox.$inferSelect;

type MailAuditContext = {
  actor: string;
  metadata?: Record<string, unknown>;
};

type DeliveryResult =
  | { ok: true; messageId: string | null }
  | { ok: false; error: string; messageId?: null };

function storedBodyAfterAttempt(purpose: string, body: string) {
  return SENSITIVE_LINK_PURPOSES.has(purpose)
    ? "[redacted after delivery attempt: sensitive one-time link removed]"
    : body;
}

function canRetryStoredMessage(row: OutboxRow) {
  if (row.channel !== "email") return false;
  if (row.status === "sent" || row.status === "pending") return false;
  if (SENSITIVE_LINK_PURPOSES.has(row.purpose) && row.status !== "queued") return false;
  return row.status === "queued" || row.status === "failed";
}

async function writeMailAudit(input: {
  organizationId: number | null;
  actor: string;
  action: string;
  outboxId: number;
  purpose: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await recordAuditEvent({
      organizationId: input.organizationId,
      actor: input.actor,
      action: input.action,
      resource: `outbox #${input.outboxId}`,
      metadata: {
        outboxId: input.outboxId,
        purpose: input.purpose,
        ...(input.metadata ?? {}),
      },
    });
  } catch {
    // Delivery state is authoritative in the outbox row. Audit enrichment must
    // never turn a successful financial release or email send into a failure.
  }
}

async function attemptDelivery(providerName: MailProvider, row: OutboxRow): Promise<DeliveryResult> {
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
        tags: [
          { name: "app", value: "linaw" },
          { name: "outbox_id", value: String(row.id) },
          { name: "purpose", value: row.purpose.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256) },
        ],
      }),
    });
    if (!response.ok) return { ok: false, error: `Resend HTTP ${response.status}` };
    const payload = await response.json().catch(() => ({}));
    return {
      ok: true,
      messageId: typeof payload?.id === "string" ? payload.id : null,
    };
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
        Metadata: {
          app: "linaw",
          outbox_id: String(row.id),
          purpose: row.purpose,
        },
      }),
    });
    if (!response.ok) return { ok: false, error: `Postmark HTTP ${response.status}` };
    const payload = await response.json().catch(() => ({}));
    return {
      ok: true,
      messageId: typeof payload?.MessageID === "string" ? payload.MessageID : null,
    };
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
        messageId: typeof info.messageId === "string" ? info.messageId : null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "SMTP send failed";
      return { ok: false, error: `SMTP: ${message}` };
    }
  }

  return { ok: false, error: `Provider ${providerName} is not implemented.` };
}

async function finishDeliveryAttempt(input: {
  row: OutboxRow;
  providerName: MailProvider;
  result: DeliveryResult;
  audit?: MailAuditContext;
  auditAction: "Outbox delivery attempted" | "Outbox delivery retried";
  trigger?: "manual" | "automatic";
}) {
  await ensureOutboxDeliverySchema();
  const now = new Date();
  const [current] = await db
    .select()
    .from(outbox)
    .where(eq(outbox.id, input.row.id))
    .limit(1);

  // A provider webhook may beat this request's response back to the database.
  // If that happened, the provider already proved acceptance and possibly final
  // delivery. Preserve that state instead of overwriting it with a network error.
  const providerConfirmed = Boolean(
    current?.providerMessageId
    && current.deliveryStatus
  );
  const effectiveOk = input.result.ok || providerConfirmed;
  const effectiveMessageId = input.result.ok
    ? input.result.messageId
    : current?.providerMessageId ?? null;

  await db.update(outbox).set({
    status: effectiveOk ? "sent" : "failed",
    provider: input.providerName,
    providerMessageId: effectiveMessageId,
    deliveryStatus: providerConfirmed ? current!.deliveryStatus : null,
    deliveryEventAt: providerConfirmed ? current!.deliveryEventAt : null,
    deliveryDetail: providerConfirmed ? current!.deliveryDetail : null,
    sentAt: effectiveOk ? current?.sentAt ?? now : null,
    error: effectiveOk ? null : input.result.ok ? null : input.result.error,
    body: storedBodyAfterAttempt(input.row.purpose, input.row.body),
  }).where(eq(outbox.id, input.row.id));

  if (input.audit) {
    await writeMailAudit({
      organizationId: input.row.organizationId,
      actor: input.audit.actor,
      action: input.auditAction,
      outboxId: input.row.id,
      purpose: input.row.purpose,
      metadata: {
        ...(input.audit.metadata ?? {}),
        trigger: input.trigger ?? "initial",
        provider: input.providerName,
        status: effectiveOk ? "sent" : "failed",
        providerMessageId: effectiveMessageId,
        error: effectiveOk ? null : input.result.ok ? null : input.result.error,
        providerConfirmedBeforeAttemptFinalized: providerConfirmed,
        attemptedAt: now.toISOString(),
      },
    });
  }

  return {
    delivered: effectiveOk,
    queued: false,
    provider: input.providerName,
    id: input.row.id,
    status: effectiveOk ? "sent" as const : "failed" as const,
    reason: effectiveOk ? null : input.result.ok ? null : input.result.error,
    providerMessageId: effectiveMessageId,
  };
}

/**
 * Queues a message and attempts real delivery only when a provider is
 * configured. With no provider the row stays `queued` and is visible in the
 * admin outbox, it is never reported as sent.
 *
 * Optional audit context links operational messages such as payslip-ready
 * notices to the exact payroll run / employee without expanding the outbox
 * schema or storing message bodies in the audit trail.
 */
export async function queueMessage(input: {
  organizationId?: number | null;
  channel?: "email" | "sms";
  recipient: string;
  subject: string;
  body: string;
  purpose: string;
  dedupeKey?: string | null;
  audit?: MailAuditContext;
}) {
  await ensureOutboxDeliverySchema();
  const providerName = provider();
  const inserted = await db.insert(outbox).values({
    organizationId: input.organizationId ?? null,
    channel: input.channel ?? "email",
    recipient: input.recipient,
    subject: input.subject,
    body: input.body,
    purpose: input.purpose,
    provider: providerName,
    status: providerName === "none" ? "queued" : "pending",
    metadata: input.audit?.metadata ?? {},
    dedupeKey: input.dedupeKey ?? null,
  }).onConflictDoNothing().returning();

  let row = inserted[0];
  let duplicate = false;
  if (!row && input.dedupeKey) {
    [row] = await db
      .select()
      .from(outbox)
      .where(eq(outbox.dedupeKey, input.dedupeKey))
      .limit(1);
    duplicate = Boolean(row);
  }
  if (!row) throw new Error("Outbox message could not be created.");

  if (duplicate) {
    if (input.audit) {
      await writeMailAudit({
        organizationId: row.organizationId,
        actor: input.audit.actor,
        action: "Outbox duplicate suppressed",
        outboxId: row.id,
        purpose: row.purpose,
        metadata: {
          ...(input.audit.metadata ?? {}),
          dedupeKey: input.dedupeKey,
          existingStatus: row.status,
        },
      });
    }
    return {
      delivered: row.status === "sent",
      queued: row.status === "queued" || row.status === "pending",
      provider: row.provider as MailProvider,
      id: row.id,
      status: row.status as "queued" | "pending" | "sent" | "failed",
      reason: row.error,
      providerMessageId: row.providerMessageId,
      duplicate: true as const,
    };
  }

  if (input.audit) {
    await writeMailAudit({
      organizationId: row.organizationId,
      actor: input.audit.actor,
      action: "Outbox message queued",
      outboxId: row.id,
      purpose: row.purpose,
      metadata: {
        ...(input.audit.metadata ?? {}),
        dedupeKey: input.dedupeKey ?? null,
        provider: providerName,
        status: row.status,
        queuedAt: row.createdAt.toISOString(),
      },
    });
  }

  if (providerName === "none") {
    return {
      delivered: false,
      queued: true,
      provider: providerName,
      id: row.id,
      status: "queued" as const,
      reason: "No email provider configured (set RESEND_API_KEY, POSTMARK_SERVER_TOKEN, or SMTP_URL).",
      providerMessageId: null,
      duplicate: false as const,
    };
  }

  try {
    const result = await attemptDelivery(providerName, row);
    return {
      ...(await finishDeliveryAttempt({
        row,
        providerName,
        result,
        audit: input.audit,
        auditAction: "Outbox delivery attempted",
      })),
      duplicate: false as const,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "delivery error";
    return {
      ...(await finishDeliveryAttempt({
        row,
        providerName,
        result: { ok: false, error: message },
        audit: input.audit,
        auditAction: "Outbox delivery attempted",
      })),
      duplicate: false as const,
    };
  }
}
export async function getOutboxMessage(id: number, organizationId: number) {
  await ensureOutboxDeliverySchema();
  const [row] = await db
    .select()
    .from(outbox)
    .where(and(eq(outbox.id, id), eq(outbox.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

/**
 * Retries the same durable outbox row. The status transition to `pending` is
 * claimed atomically so a worker and an operator cannot send the same message
 * concurrently.
 */
export async function retryOutboxMessage(input: {
  id: number;
  organizationId: number;
  actor: string;
  trigger: "manual" | "automatic";
}) {
  const row = await getOutboxMessage(input.id, input.organizationId);
  if (!row) {
    return { ok: false as const, httpStatus: 404, error: "Outbox message not found." };
  }
  if (row.status === "sent") {
    return {
      ok: true as const,
      alreadySent: true,
      id: row.id,
      httpStatus: 200,
      deliveryStatus: "sent" as const,
      provider: row.provider,
    };
  }
  if (row.status === "pending") {
    return { ok: false as const, httpStatus: 409, error: "This message is already being delivered." };
  }
  if (!canRetryStoredMessage(row)) {
    return {
      ok: false as const,
      httpStatus: 409,
      error: SENSITIVE_LINK_PURPOSES.has(row.purpose)
        ? "This one-time-link message cannot be retried after an attempt. Generate a new link instead."
        : "This outbox message is not retryable.",
    };
  }

  const providerName = provider();
  if (providerName === "none") {
    if (row.status !== "queued") {
      await db.update(outbox).set({
        status: "queued",
        provider: "none",
        error: "Waiting for an email provider before retry.",
      }).where(and(eq(outbox.id, row.id), eq(outbox.status, row.status)));
    }
    return {
      ok: false as const,
      httpStatus: 503,
      error: "No email provider is configured. The message remains queued.",
      queued: true as const,
    };
  }

  const [claimed] = await db.update(outbox).set({
    status: "pending",
    provider: providerName,
    error: null,
  }).where(and(eq(outbox.id, row.id), eq(outbox.status, row.status))).returning();

  if (!claimed) {
    return {
      ok: false as const,
      httpStatus: 409,
      error: "Another delivery attempt already claimed this message.",
    };
  }

  const result = await attemptDelivery(providerName, claimed);
  const finished = await finishDeliveryAttempt({
    row: claimed,
    providerName,
    result,
    audit: { actor: input.actor },
    auditAction: "Outbox delivery retried",
    trigger: input.trigger,
  });

  return {
    ok: finished.delivered,
    httpStatus: finished.delivered ? 200 : 502,
    deliveryStatus: finished.status,
    delivered: finished.delivered,
    queued: finished.queued,
    provider: finished.provider,
    id: finished.id,
    reason: finished.reason,
    providerMessageId: finished.providerMessageId,
    error: finished.delivered ? undefined : finished.reason ?? "Delivery retry failed.",
  };
}

function auditMetadata(event: typeof auditEvents.$inferSelect) {
  return event.metadata && typeof event.metadata === "object"
    ? event.metadata as Record<string, unknown>
    : {};
}

function stateLabel(row: OutboxRow, retryCount: number, deliveryStatus?: string | null) {
  if (row.status === "sent") {
    if (deliveryStatus === "delivered") return "Delivered";
    if (deliveryStatus === "delayed") return "Delivery delayed";
    if (deliveryStatus === "bounced") return "Bounced";
    if (deliveryStatus === "complained") return "Complaint";
    if (deliveryStatus === "failed") return "Provider failed";
    if (deliveryStatus === "suppressed") return "Suppressed";
    return retryCount > 0 ? "Sent after retry" : "Sent";
  }
  if (row.status === "failed") return retryCount > 0 ? "Retry failed" : "Failed";
  if (row.status === "pending") return "Sending";
  if (row.status === "queued") return retryCount > 0 ? "Queued for retry" : "Queued";
  return row.status;
}

export async function recentOutbox(limit = 25, organizationId?: number) {
  await ensureOutboxDeliverySchema();
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

export async function recordEmailProviderEvent(input: {
  provider: "resend" | "postmark";
  eventId: string;
  outboxId: number;
  providerMessageId: string;
  eventType: string;
  deliveryStatus: string;
  occurredAt: string;
  detail?: string | null;
}) {
  await ensureOutboxDeliverySchema();
  const [row] = await db
    .select()
    .from(outbox)
    .where(eq(outbox.id, input.outboxId))
    .limit(1);

  if (!row || row.provider !== input.provider) {
    return { matched: false as const, duplicate: false as const };
  }

  if (row.providerMessageId && row.providerMessageId !== input.providerMessageId) {
    return { matched: false as const, duplicate: false as const };
  }

  const events = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.action, "Email provider delivery event"))
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(500);

  const duplicate = events.some((event) => {
    const metadata = auditMetadata(event);
    return metadata.provider === input.provider && metadata.eventId === input.eventId;
  });
  if (duplicate) {
    return { matched: true as const, duplicate: true as const, outboxId: row.id };
  }

  const occurredAt = new Date(input.occurredAt);
  const deliveryEventAt = Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt;
  await db.update(outbox).set({
    providerMessageId: row.providerMessageId ?? input.providerMessageId,
    deliveryStatus: input.deliveryStatus,
    deliveryEventAt,
    deliveryDetail: input.detail ?? null,
  }).where(eq(outbox.id, row.id));

  await writeMailAudit({
    organizationId: row.organizationId,
    actor: `system:${input.provider}-webhook`,
    action: "Email provider delivery event",
    outboxId: row.id,
    purpose: row.purpose,
    metadata: {
      provider: input.provider,
      eventId: input.eventId,
      providerMessageId: input.providerMessageId,
      eventType: input.eventType,
      deliveryStatus: input.deliveryStatus,
      occurredAt: input.occurredAt,
      detail: input.detail ?? null,
    },
  });

  return { matched: true as const, duplicate: false as const, outboxId: row.id };
}

export async function recentOutboxWithAttempts(limit = 50, organizationId: number) {
  const rows = await recentOutbox(limit, organizationId);
  if (rows.length === 0) return [];

  const events = await db
    .select()
    .from(auditEvents)
    .where(and(
      eq(auditEvents.organizationId, organizationId),
      inArray(auditEvents.action, [
        "Outbox message queued",
        "Outbox delivery attempted",
        "Outbox delivery retried",
        "Email provider delivery event",
      ]),
    ))
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id));

  return rows.map((row) => {
    const rowEvents = events.filter((event) => Number(auditMetadata(event).outboxId) === row.id);
    const retryEvents = rowEvents.filter((event) => event.action === "Outbox delivery retried");
    const attemptEvents = rowEvents.filter((event) =>
      event.action === "Outbox delivery attempted" || event.action === "Outbox delivery retried"
    );
    const queueEvent = rowEvents.find((event) => event.action === "Outbox message queued");
    const providerEvent = rowEvents.find((event) => event.action === "Email provider delivery event");
    const storedContext = row.metadata && typeof row.metadata === "object"
      ? row.metadata as Record<string, unknown>
      : {};
    const context = Object.keys(storedContext).length > 0
      ? storedContext
      : queueEvent
        ? auditMetadata(queueEvent)
        : {};
    const lastAttempt = attemptEvents[0];
    const lastAttemptMeta = lastAttempt ? auditMetadata(lastAttempt) : {};
    const providerEventMeta = providerEvent ? auditMetadata(providerEvent) : {};
    const auditDeliveryStatus = typeof providerEventMeta.deliveryStatus === "string"
      ? providerEventMeta.deliveryStatus
      : null;
    const deliveryStatus = row.deliveryStatus ?? auditDeliveryStatus;

    return {
      ...row,
      body: undefined,
      retryCount: retryEvents.length,
      attemptCount: attemptEvents.length,
      stateLabel: stateLabel(row, retryEvents.length, deliveryStatus),
      canRetry: canRetryStoredMessage(row),
      lastAttemptAt: lastAttempt?.createdAt ?? null,
      providerMessageId:
        row.providerMessageId
        ?? (typeof lastAttemptMeta.providerMessageId === "string" ? lastAttemptMeta.providerMessageId : null),
      deliveryStatus,
      deliveryEventAt: row.deliveryEventAt ?? providerEvent?.createdAt ?? null,
      deliveryDetail:
        row.deliveryDetail
        ?? (typeof providerEventMeta.detail === "string" ? providerEventMeta.detail : null),
      runId: Number.isFinite(Number(context.runId)) ? Number(context.runId) : null,
      employeeId: Number.isFinite(Number(context.employeeId)) ? Number(context.employeeId) : null,
      periodLabel: typeof context.periodLabel === "string" ? context.periodLabel : null,
    };
  });
}

export async function retryFailedPayslipNotices(input: {
  organizationId: number;
  actor: string;
  limit?: number;
}) {
  await ensureOutboxDeliverySchema();
  const rows = await db
    .select()
    .from(outbox)
    .where(and(
      eq(outbox.organizationId, input.organizationId),
      eq(outbox.purpose, "payslip-ready"),
      eq(outbox.status, "failed"),
    ))
    .orderBy(asc(outbox.id))
    .limit(Math.max(1, Math.min(input.limit ?? 100, 250)));

  const results = [];
  for (const row of rows) {
    results.push(await retryOutboxMessage({
      id: row.id,
      organizationId: input.organizationId,
      actor: input.actor,
      trigger: "manual",
    }));
  }

  return {
    requested: rows.length,
    sent: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    results,
  };
}

/**
 * Background retry is deliberately narrow: only payslip-ready notices are
 * retried automatically. Password resets, invitations and email-change links
 * must be regenerated instead of replaying stale one-time credentials.
 */
export async function drainOutboxRetries(limit = 25) {
  await ensureOutboxDeliverySchema();
  if (!capableHere()) return [];

  const candidates = await db
    .select()
    .from(outbox)
    .where(and(
      eq(outbox.purpose, "payslip-ready"),
      inArray(outbox.status, ["queued", "failed"]),
    ))
    .orderBy(asc(outbox.id))
    .limit(limit);

  if (candidates.length === 0) return [];

  const events = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.action, "Outbox delivery retried"))
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id));

  const now = Date.now();
  const results: Array<{
    id: number;
    status: string;
    retried: boolean;
    reason?: string;
  }> = [];

  for (const row of candidates) {
    if (row.organizationId == null) continue;

    const retryEvents = events.filter((event) =>
      Number(auditMetadata(event).outboxId) === row.id
      && auditMetadata(event).trigger === "automatic"
    );
    if (retryEvents.length >= MAX_AUTOMATIC_RETRIES) {
      results.push({ id: row.id, status: row.status, retried: false, reason: "automatic-retry-limit" });
      continue;
    }

    if (row.status === "failed") {
      const delay = AUTO_RETRY_DELAYS_MS[Math.min(retryEvents.length, AUTO_RETRY_DELAYS_MS.length - 1)];
      const latestRetryAt = retryEvents[0]?.createdAt
        ? new Date(retryEvents[0].createdAt).getTime()
        : new Date(row.createdAt).getTime();
      if (now - latestRetryAt < delay) {
        results.push({ id: row.id, status: row.status, retried: false, reason: "backoff" });
        continue;
      }
    }

    const retry = await retryOutboxMessage({
      id: row.id,
      organizationId: row.organizationId,
      actor: "system:mail-worker",
      trigger: "automatic",
    });

    results.push({
      id: row.id,
      status: retry.ok ? "sent" : "failed",
      retried: true,
      reason: retry.ok ? undefined : retry.error,
    });
  }

  return results;
}
