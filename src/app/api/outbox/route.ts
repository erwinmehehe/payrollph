import { getSessionUser } from "@/lib/auth";
import { activeMailProvider, deliveryCapable, recentOutbox } from "@/lib/mailer";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const rows = await recentOutbox(50);
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
