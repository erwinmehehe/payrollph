import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  normalizeResendEmailEvent,
  verifyResendWebhookSignature,
} from "../src/lib/resend-webhook";

function signature(input: {
  secret: string;
  id: string;
  timestamp: string;
  payload: string;
}) {
  const key = Buffer.from(input.secret.replace(/^whsec_/, ""), "base64");
  return createHmac("sha256", key)
    .update(`${input.id}.${input.timestamp}.${input.payload}`)
    .digest("base64");
}

test("Resend webhook signature verification accepts a valid current Svix signature", () => {
  const secret = `whsec_${Buffer.from("linaw-webhook-secret").toString("base64")}`;
  const id = "msg_test_123";
  const timestamp = "1790758800";
  const payload = JSON.stringify({ type: "email.delivered", data: { email_id: "email_123" } });
  const signed = signature({ secret, id, timestamp, payload });

  assert.equal(verifyResendWebhookSignature({
    payload,
    id,
    timestamp,
    signature: `v1,${signed}`,
    secret,
    nowMs: 1790758800 * 1000,
  }), true);
});

test("Resend webhook signature verification rejects tampering and stale timestamps", () => {
  const secret = `whsec_${Buffer.from("linaw-webhook-secret").toString("base64")}`;
  const id = "msg_test_456";
  const timestamp = "1790758800";
  const payload = "{}";
  const signed = signature({ secret, id, timestamp, payload });

  assert.equal(verifyResendWebhookSignature({
    payload: "{\"tampered\":true}",
    id,
    timestamp,
    signature: `v1,${signed}`,
    secret,
    nowMs: 1790758800 * 1000,
  }), false);

  assert.equal(verifyResendWebhookSignature({
    payload,
    id,
    timestamp,
    signature: `v1,${signed}`,
    secret,
    nowMs: (1790758800 + 301) * 1000,
  }), false);
});

test("Resend delivery events are accepted only for tagged Linaw outbox messages", () => {
  const event = normalizeResendEmailEvent({
    type: "email.bounced",
    created_at: "2026-09-30T09:30:00.000Z",
    data: {
      email_id: "email_abc",
      tags: {
        app: "linaw",
        outbox_id: "42",
        purpose: "payslip-ready",
      },
      bounce: {
        message: "Mailbox does not exist",
      },
    },
  });

  assert.deepEqual(event, {
    provider: "resend",
    providerMessageId: "email_abc",
    eventType: "email.bounced",
    deliveryStatus: "bounced",
    occurredAt: "2026-09-30T09:30:00.000Z",
    outboxId: 42,
    detail: "Mailbox does not exist",
  });

  assert.equal(normalizeResendEmailEvent({
    type: "email.delivered",
    data: {
      email_id: "email_other",
      tags: { app: "another-app", outbox_id: "42" },
    },
  }), null);
});
