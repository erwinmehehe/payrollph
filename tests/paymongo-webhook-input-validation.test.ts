import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  normalizePaymongoTransferWebhook,
  verifyPaymongoWebhookSignature,
} from "../src/lib/paymongo-transfer-webhook";

function eventWith(amount: unknown, reference = "PAY-77-E-001", createdAt: unknown = 1790812800) {
  return {
    data: {
      id: "evt_guardrail",
      attributes: {
        type: "transfer.outward.successful",
        livemode: true,
        created_at: createdAt,
        data: {
          id: "tr_guardrail",
          attributes: {
            transfer_id: "tr_guardrail",
            reference_number: reference,
            status: "succeeded",
            amount,
          },
        },
      },
    },
  };
}

test("signed transfer event normalization refuses missing, coerced, nonpositive or unsafe cents", () => {
  for (const amount of [undefined, null, "", "100", true, false, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(normalizePaymongoTransferWebhook(eventWith(amount)), null, String(amount));
  }
  const valid = normalizePaymongoTransferWebhook(eventWith(2500000));
  assert.ok(valid);
  assert.equal(valid.amountCents, 2500000);
  assert.equal(valid.runId, 77);
});

test("payroll run id parsed from provider reference must be a safe positive integer", () => {
  for (const reference of ["PAY-0-E-001", "PAY-9007199254740992-E-001", "OTHER-77-E-001"]) {
    assert.equal(normalizePaymongoTransferWebhook(eventWith(200, reference)), null);
  }
});

test("extreme event timestamp cannot throw or inject an invalid settlement date", () => {
  const before = Date.now();
  const result = normalizePaymongoTransferWebhook(eventWith(200, "PAY-77-E-001", 1e20));
  assert.ok(result);
  const parsedDate = Date.parse(result.occurredAt);
  assert.ok(Number.isFinite(parsedDate));
  assert.ok(parsedDate >= before && parsedDate <= Date.now() + 1000);
});

test("canonical numeric-string provider timestamp remains auditable", () => {
  const result = normalizePaymongoTransferWebhook(eventWith(200, "PAY-77-E-001", "1790812800"));
  assert.ok(result);
  assert.equal(result.occurredAt, new Date(1790812800 * 1000).toISOString());
});

test("signature verifier refuses a correct digest with nonhex garbage suffix", () => {
  const payload = '{"data":{"id":"evt_guardrail","attributes":{"livemode":false}}}';
  const timestamp = "1790812800";
  const secret = "test_only_webhook_secret";
  const digest = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const nowMs = Number(timestamp) * 1000;
  assert.equal(verifyPaymongoWebhookSignature({
    payload, signatureHeader: `t=${timestamp},te=${digest}`, secret, nowMs,
  }), true);
  assert.equal(verifyPaymongoWebhookSignature({
    payload, signatureHeader: `t=${timestamp},te=${digest}ZZZZ`, secret, nowMs,
  }), false);
});

test("PayMongo verifier requires the signature that corresponds to the signed event mode", () => {
  const secret = "test_only_webhook_secret";
  const timestamp = "1790812800";
  const nowMs = Number(timestamp) * 1000;
  const livePayload = '{"data":{"id":"evt_live","attributes":{"livemode":true}}}';
  const liveDigest = createHmac("sha256", secret).update(`${timestamp}.${livePayload}`).digest("hex");
  assert.equal(verifyPaymongoWebhookSignature({
    payload: livePayload, signatureHeader: `t=${timestamp},te=,li=${liveDigest}`, secret, nowMs,
  }), true);
  assert.equal(verifyPaymongoWebhookSignature({
    payload: livePayload, signatureHeader: `t=${timestamp},te=${liveDigest},li=`, secret, nowMs,
  }), false, "a valid test-mode signature cannot authenticate a live event");
  const missingMode = '{"data":{"id":"evt_missing_mode","attributes":{}}}';
  const missingDigest = createHmac("sha256", secret).update(`${timestamp}.${missingMode}`).digest("hex");
  assert.equal(verifyPaymongoWebhookSignature({
    payload: missingMode, signatureHeader: `t=${timestamp},te=${missingDigest}`, secret, nowMs,
  }), false);
});
