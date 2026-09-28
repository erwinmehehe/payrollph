import { assertOrganizationRole, PAYROLL_OPERATOR_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { activeMailProvider, deliveryCapable, recentOutbox } from "@/lib/mailer";

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
