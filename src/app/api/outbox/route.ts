import { assertOrganizationRole, PAYROLL_OPERATOR_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import {
  activeMailProvider,
  deliveryCapable,
  isSensitiveMailPurpose,
  outboxDeliverySummary,
  outboxDisplayStatus,
  recentOutbox,
  retryOutboxMessage,
} from "@/lib/mailer";
import { enforceSameOriginMutation } from "@/lib/security-request";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PAYROLL_OPERATOR_ROLES,
    "Only payroll operators can view the email outbox.",
  );
  if (denied) return denied;

  const [rows, summary] = await Promise.all([
    recentOutbox(100, organizationId),
    outboxDeliverySummary(organizationId),
  ]);

  const capable = deliveryCapable();
  return Response.json({
    provider: activeMailProvider(),
    deliveryCapable: capable,
    summary,
    messages: rows.map((row) => {
      const sensitive = isSensitiveMailPurpose(row.purpose);
      const displayStatus = outboxDisplayStatus(row);
      return {
        id: row.id,
        channel: row.channel,
        recipient: row.recipient,
        subject: row.subject,
        purpose: row.purpose,
        status: row.status,
        displayStatus,
        provider: row.provider,
        providerMessageId: row.providerMessageId,
        attempts: row.attempts,
        maxAttempts: row.maxAttempts,
        error: row.error,
        lastAttemptAt: row.lastAttemptAt,
        nextAttemptAt: row.nextAttemptAt,
        sentAt: row.sentAt,
        createdAt: row.createdAt,
        metadata: row.metadata,
        sensitive,
        body: sensitive
          ? "[Sensitive one-time-link body hidden from the outbox inspector.]"
          : row.body,
        retryable:
          capable
          && displayStatus !== "sent"
          && displayStatus !== "retried"
          && displayStatus !== "sending"
          && !(sensitive && row.attempts > 0),
      };
    }),
    note: capable
      ? "Failed non-sensitive messages retry with bounded backoff. Operators can retry a failed message manually without duplicating sent mail."
      : "Messages stay queued while no provider is configured. They are never reported as sent.",
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const messageId = Number(body.messageId);
  if (!Number.isInteger(organizationId) || !Number.isInteger(messageId)) {
    return Response.json({ error: "organizationId and messageId are required." }, { status: 400 });
  }
  if (body.action !== "retry") {
    return Response.json({ error: "Unsupported outbox action." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PAYROLL_OPERATOR_ROLES,
    "Only payroll operators can retry email delivery.",
  );
  if (denied) return denied;

  try {
    const result = await retryOutboxMessage(messageId, organizationId);
    return Response.json({
      ...result,
      displayStatus: result.delivered && result.attempts > 1 ? "retried" : result.status,
      message: result.delivered
        ? "Message delivered successfully."
        : result.queued
          ? "Message remains queued until an email provider is configured."
          : result.reason ?? "Delivery attempt finished.",
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Message retry failed." },
      { status: 409 },
    );
  }
}
