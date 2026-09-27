import assert from "node:assert/strict";
import test from "node:test";
import { signWebhookPayload, verifyWebhookSignature, WEBHOOK_EVENTS } from "../src/lib/webhook-signing";
import { mintApiKey, requireScope } from "../src/lib/api-keys";
import { toCsv as reportToCsv } from "../src/lib/csv";

test("webhook signatures verify and reject tampering", () => {
  const secret = "whsec_testsecret";
  const payload = JSON.stringify({ event: "payroll.processed", data: { runId: 7 } });
  const timestamp = Math.floor(Date.now() / 1000);
  const header = signWebhookPayload(secret, payload, timestamp);

  assert.equal(verifyWebhookSignature(secret, payload, header), true);
  assert.equal(verifyWebhookSignature(secret, payload + "x", header), false);
  assert.equal(verifyWebhookSignature("wrong_secret", payload, header), false);
});

test("webhook signatures expire outside the tolerance window", () => {
  const secret = "whsec_testsecret";
  const payload = "{}";
  const old = Math.floor(Date.now() / 1000) - 4000;
  const header = signWebhookPayload(secret, payload, old);
  assert.equal(verifyWebhookSignature(secret, payload, header, 300), false);
  assert.equal(verifyWebhookSignature(secret, payload, header, 100000), true);
});

test("documented webhook events are stable", () => {
  assert.ok(WEBHOOK_EVENTS.includes("payroll.released"));
  assert.ok(WEBHOOK_EVENTS.includes("employee.onboarded"));
  assert.ok(WEBHOOK_EVENTS.includes("leave.approved"));
});

test("API keys are hashed, prefixed, and scope-checked", () => {
  const minted = mintApiKey();
  assert.ok(minted.key.startsWith("sk_live_"));
  assert.equal(minted.prefix, minted.key.slice(0, 12));
  assert.notEqual(minted.keyHash, minted.key);
  assert.equal(minted.keyHash.length, 64);

  assert.equal(requireScope(["employees:read"], "employees:read"), true);
  assert.equal(requireScope(["employees:read"], "payroll:read"), false);
  assert.equal(requireScope(["*"], "payroll:read"), true);
});

test("report CSV escapes embedded quotes and commas", () => {
  const csv = reportToCsv({
    columns: ["Metric", "Detail"],
    rows: [["Separating", 'needs "review", urgently']],
  });
  assert.equal(csv.split("\n")[0], '"Metric","Detail"');
  assert.ok(csv.includes('"needs ""review"", urgently"'));
});
