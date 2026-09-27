import { getSessionUser } from "@/lib/auth";
import { assertPermission } from "@/lib/access";
import { activeMailProvider, deliveryCapable, recentOutbox } from "@/lib/mailer";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId") ?? 0);
  if (!Number.isInteger(organizationId) || organizationId <= 0) return Response.json({ error: "organizationId is required." }, { status: 400 });
  const denied = await assertPermission(user.id, organizationId, "mail:read");
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
      // Bodies are omitted; only an operator with DB access needs those.
    })),
    note: "Messages stay 'queued' while no provider is configured. They are never reported as sent.",
  });
}
