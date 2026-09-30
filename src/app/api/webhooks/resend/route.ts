import { recordEmailProviderEvent } from "@/lib/mailer";
import {
  normalizeResendEmailEvent,
  verifyResendWebhookSignature,
} from "@/lib/resend-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json(
      { error: "Resend webhook verification is not configured." },
      { status: 503 },
    );
  }

  const payload = await request.text();
  const eventId = request.headers.get("svix-id");
  const valid = verifyResendWebhookSignature({
    payload,
    id: eventId,
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
    secret,
  });

  if (!valid) {
    return Response.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  const parsed = (() => {
    try {
      return JSON.parse(payload) as unknown;
    } catch {
      return null;
    }
  })();

  if (!parsed) {
    return Response.json({ error: "Invalid webhook payload." }, { status: 400 });
  }

  const event = normalizeResendEmailEvent(parsed);
  if (!event) {
    return Response.json({ ok: true, ignored: true });
  }

  const result = await recordEmailProviderEvent({
    provider: event.provider,
    eventId: eventId as string,
    outboxId: event.outboxId,
    providerMessageId: event.providerMessageId,
    eventType: event.eventType,
    deliveryStatus: event.deliveryStatus,
    occurredAt: event.occurredAt,
    detail: event.detail,
  });

  return Response.json({ ok: true, ...result });
}
