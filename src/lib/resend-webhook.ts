import { createHmac, timingSafeEqual } from "node:crypto";

const RESEND_EVENT_STATUS = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
  "email.suppressed": "suppressed",
} as const;

export type ResendDeliveryStatus = (typeof RESEND_EVENT_STATUS)[keyof typeof RESEND_EVENT_STATUS];

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function safeEqualBase64(left: string, right: string) {
  try {
    const a = Buffer.from(left, "base64");
    const b = Buffer.from(right, "base64");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function verifyResendWebhookSignature(input: {
  payload: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  secret: string;
  nowMs?: number;
  toleranceSeconds?: number;
}) {
  if (!input.id || !input.timestamp || !input.signature || !input.secret) return false;

  const timestampSeconds = Number(input.timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;

  const tolerance = input.toleranceSeconds ?? 5 * 60;
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > tolerance) return false;

  const encodedSecret = input.secret.startsWith("whsec_")
    ? input.secret.slice("whsec_".length)
    : input.secret;

  let key: Buffer;
  try {
    key = Buffer.from(encodedSecret, "base64");
  } catch {
    return false;
  }
  if (key.length === 0) return false;

  const signedPayload = `${input.id}.${input.timestamp}.${input.payload}`;
  const expected = createHmac("sha256", key)
    .update(signedPayload)
    .digest("base64");

  return input.signature
    .split(/\s+/)
    .some((part) => {
      const [version, signature] = part.split(",", 2);
      return version === "v1" && Boolean(signature) && safeEqualBase64(signature, expected);
    });
}

function eventDetail(data: JsonRecord) {
  const bounce = asRecord(data.bounce);
  const candidates = [
    bounce?.message,
    data.reason,
    data.error,
    data.message,
  ];
  return candidates.find((value): value is string => typeof value === "string") ?? null;
}

export function normalizeResendEmailEvent(payload: unknown) {
  const root = asRecord(payload);
  if (!root || typeof root.type !== "string") return null;

  const status = RESEND_EVENT_STATUS[root.type as keyof typeof RESEND_EVENT_STATUS];
  if (!status) return null;

  const data = asRecord(root.data);
  if (!data || typeof data.email_id !== "string") return null;

  const tags = asRecord(data.tags);
  if (!tags || tags.app !== "linaw") return null;

  const outboxId = Number(tags.outbox_id);
  if (!Number.isInteger(outboxId) || outboxId <= 0) return null;

  return {
    provider: "resend" as const,
    providerMessageId: data.email_id,
    eventType: root.type,
    deliveryStatus: status,
    occurredAt: typeof root.created_at === "string"
      ? root.created_at
      : new Date().toISOString(),
    outboxId,
    detail: eventDetail(data),
  };
}
