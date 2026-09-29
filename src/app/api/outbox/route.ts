import { assertOrganizationRole, PAYROLL_OPERATOR_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { activeMailProvider, deliveryCapable, recentOutbox, retryOutboxMessage } from "@/lib/mailer";

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

  const rows = await recentOutbox(50, organizationId);
  return Response.json({
    provider: activeMailProvider(),
    deliveryCapable: deliveryCapable(),
    messages: rows.map((row) => ({
      id: row.id,
      channel: row.channel,
      recipient: row.recipient,
      subject: row.subject,
      purpose: row.purpose,
      status: row.status,
      provider: row.provider,
      error: row.error,
      sentAt: row.sentAt,
      createdAt: row.createdAt,
    })),
    note: "Messages stay queued while no provider is configured. They are never reported as sent.",
  });
}


export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const messageId = Number(body.messageId);
  if (!Number.isInteger(organizationId) || !Number.isInteger(messageId)) {
    return Response.json({ error: "organizationId and messageId are required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PAYROLL_OPERATOR_ROLES,
    "Only payroll operators can retry email outbox messages.",
  );
  if (denied) return denied;

  const result = await retryOutboxMessage({ organizationId, messageId });
  if (!result) {
    return Response.json({ error: "Outbox message not found in this workspace." }, { status: 404 });
  }
  if (result.alreadySent) {
    return Response.json({ error: "This outbox message was already sent.", result }, { status: 409 });
  }

  return Response.json({
    result,
    note: result.delivered
      ? "Message sent."
      : result.queued
        ? "Message is queued because no delivery provider is configured."
        : "Retry attempted but delivery still failed.",
  }, { status: result.delivered || result.queued ? 200 : 502 });
}
