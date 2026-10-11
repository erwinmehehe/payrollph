import { createHmac, timingSafeEqual } from "node:crypto";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function safeEqualHex(left: string, right: string) {
  // Buffer.from(..., "hex") silently truncates invalid trailing characters.
  // Require an exact SHA-256 hex digest before constant-time comparison.
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  try {
    const a = Buffer.from(left, "hex");
    const b = Buffer.from(right, "hex");
    return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function verifyPaymongoWebhookSignature(input: {
  payload: string;
  signatureHeader: string | null;
  secret: string;
  nowMs?: number;
  toleranceSeconds?: number;
}) {
  if (!input.signatureHeader || !input.secret) return false;

  const parts = new Map(
    input.signatureHeader
      .split(",")
      .map((part) => part.trim().split("=", 2))
      .filter((pair): pair is [string, string] => pair.length === 2 && Boolean(pair[0]) && Boolean(pair[1])),
  );
  const timestamp = parts.get("t");
  if (!timestamp) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  const tolerance = input.toleranceSeconds ?? 5 * 60;
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > tolerance) return false;

  const expected = createHmac("sha256", input.secret)
    .update(`${timestamp}.${input.payload}`)
    .digest("hex");

  // PayMongo specifies different signature slots for live and test events.
  // Select the slot from the signed raw payload, never accept whichever
  // environment signature happens to match.
  let livemode: boolean;
  try {
    const envelope = asRecord(JSON.parse(input.payload) as unknown);
    const event = asRecord(envelope?.data) ?? envelope;
    const attributes = asRecord(event?.attributes);
    if (!attributes || typeof attributes.livemode !== "boolean") return false;
    livemode = attributes.livemode;
  } catch {
    return false;
  }
  const candidate = parts.get(livemode ? "li" : "te");
  return Boolean(candidate && safeEqualHex(candidate, expected));
}

export type PaymongoTransferWebhookEvent = {
  eventId: string;
  eventType: "transfer.outward.successful" | "transfer.outward.failed";
  liveMode: boolean;
  runId: number;
  employeeNo: string;
  transferId: string;
  batchTransactionId: string | null;
  referenceNumber: string;
  status: "succeeded" | "failed";
  amountCents: number;
  provider: string | null;
  providerReferenceNumber: string | null;
  providerError: string | null;
  providerErrorCode: string | null;
  occurredAt: string;
};

export function normalizePaymongoTransferWebhook(payload: unknown): PaymongoTransferWebhookEvent | null {
  const root = asRecord(payload);
  const event = asRecord(root?.data) ?? root;
  if (!event || typeof event.id !== "string") return null;

  const eventAttributes = asRecord(event.attributes);
  if (!eventAttributes || typeof eventAttributes.type !== "string") return null;
  if (
    eventAttributes.type !== "transfer.outward.successful"
    && eventAttributes.type !== "transfer.outward.failed"
  ) return null;

  const resource = asRecord(eventAttributes.data);
  if (!resource) return null;
  const attributes = asRecord(resource.attributes) ?? resource;

  const transferId =
    typeof attributes.transfer_id === "string"
      ? attributes.transfer_id
      : typeof resource.id === "string"
        ? resource.id
        : null;
  const referenceNumber = typeof attributes.reference_number === "string"
    ? attributes.reference_number
    : null;
  // Never coerce null/booleans/strings into money amounts. A missing amount
  // must not become an apparent zero-cent settlement receipt.
  const amountCents = typeof attributes.amount === "number" ? attributes.amount : Number.NaN;
  const match = referenceNumber?.match(/^PAY-(\d+)-(.+)$/);
  const runId = match ? Number(match[1]) : Number.NaN;

  if (!transferId || !referenceNumber || !match
    || !Number.isSafeInteger(runId) || runId <= 0
    || !Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return null;
  }

  const eventType = eventAttributes.type;
  const status = eventType === "transfer.outward.successful" ? "succeeded" : "failed";
  const resourceStatus = typeof attributes.status === "string" ? attributes.status.toLowerCase() : null;
  if (resourceStatus && resourceStatus !== status) return null;

  const rawCreatedAt = eventAttributes.created_at;
  const createdAt = typeof rawCreatedAt === "number"
    ? rawCreatedAt
    : typeof rawCreatedAt === "string" && /^\d{1,12}$/.test(rawCreatedAt)
      ? Number(rawCreatedAt)
      : Number.NaN;
  const occurredAtMs = createdAt * 1000;
  // An extreme but finite timestamp can still overflow Date.toISOString().
  const occurredAt = Number.isFinite(occurredAtMs) && Math.abs(occurredAtMs) <= 8_640_000_000_000_000
    ? new Date(occurredAtMs).toISOString()
    : new Date().toISOString();
  return {
    eventId: event.id,
    eventType,
    liveMode: eventAttributes.livemode === true,
    runId,
    employeeNo: match[2],
    transferId,
    batchTransactionId: typeof attributes.batch_transaction_id === "string" && attributes.batch_transaction_id
      ? attributes.batch_transaction_id
      : null,
    referenceNumber,
    status,
    amountCents,
    provider: typeof attributes.provider === "string" ? attributes.provider : null,
    providerReferenceNumber: typeof attributes.provider_reference_number === "string"
      ? attributes.provider_reference_number
      : null,
    providerError: typeof attributes.provider_error === "string" && attributes.provider_error
      ? attributes.provider_error
      : null,
    providerErrorCode: typeof attributes.provider_error_code === "string" && attributes.provider_error_code
      ? attributes.provider_error_code
      : null,
    occurredAt,
  };
}
