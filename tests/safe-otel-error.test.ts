import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { approvedOtlpEndpoint, emitSafeOtelError, otlpErrorEnvelope, safeOtelRecord } from "../src/lib/safe-otel-error";
import { newOperationalRequestId } from "../src/lib/ops-telemetry";

test("forged exception text or government identifiers cannot enter OTLP fields", () => {
  const sensitive = "bank 1234567890 SSS 12-3456789-0 alpha@example.test SECRET";
  const record = safeOtelRecord({
    requestId: sensitive, subsystem: sensitive, code: sensitive,
    error: { message: sensitive }, metadata: { taxId: sensitive },
  } as never, Date.parse("2026-10-13T01:00:00Z"));
  assert.deepEqual(Object.keys(record).sort(), ["event", "requestId", "subsystem", "code", "timestamp"].sort());
  assert.equal(record.subsystem, "web");
  assert.equal(record.code, "UNHANDLED_SERVER_ERROR");
  assert.ok(!JSON.stringify(record).includes(sensitive));
  assert.ok(!JSON.stringify(record).includes("taxId"));
  const envelope = JSON.stringify(otlpErrorEnvelope({ ...record, error: sensitive } as never));
  assert.ok(!envelope.includes(sensitive));
  assert.ok(envelope.includes("timeUnixNano"));
});

test("flag OFF means no provider call; invalid collector URLs are rejected", async () => {
  let calls = 0;
  const transport = async () => { calls++; return { ok: true, status: 200 }; };
  const input = { requestId: newOperationalRequestId(), subsystem: "web", code: "UNHANDLED_SERVER_ERROR" } as const;
  assert.equal(await emitSafeOtelError(input, {}, transport), "disabled");
  assert.equal(await emitSafeOtelError(input, { SAFE_OTEL_ERRORS_ENABLED: "TRUE" }, transport), "disabled");
  assert.equal(await emitSafeOtelError(input, { SAFE_OTEL_ERRORS_ENABLED: "true" }, transport), "misconfigured");
  assert.equal(calls, 0);
  for (const invalid of [
    "http://collector.example/v1/logs", "https://u:p@collector.example/v1/logs",
    "https://collector.example/v1/logs?token=secret",
    "https://collector.example/v1/logs#secret",
    "https://collector.example/wrong-path",
  ]) assert.equal(approvedOtlpEndpoint(invalid), null);
});

test("authorized OTLP transport gets PII-free JSON and keeps bearer token out of body", async () => {
  const token = "synthetic-collector-token-32-bytes-or-more-2026";
  const deliveries: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const requestId = newOperationalRequestId();
  const result = await emitSafeOtelError({ requestId, subsystem: "scheduler", code: "CRON_TICK_FAILED" }, {
    SAFE_OTEL_ERRORS_ENABLED: "true",
    OTLP_LOGS_ENDPOINT: "https://collector.example/v1/logs",
    OTLP_LOGS_BEARER_TOKEN: token,
  }, async payload => { deliveries.push(payload); return { ok: true, status: 200 }; });
  assert.equal(result, "delivered");
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].headers.Authorization, "Bearer " + token);
  assert.ok(deliveries[0].body.includes(requestId));
  assert.ok(!deliveries[0].body.includes(token));
  assert.equal(JSON.parse(deliveries[0].body).resourceLogs.length, 1);
});

test("Next.js unhandled hook and authenticated cron error path use sanitized collector", () => {
  const hook = readFileSync("src/instrumentation.ts", "utf8");
  const cron = readFileSync("src/app/api/jobs/cron/route.ts", "utf8");
  assert.match(hook, /export async function onRequestError\(/);
  assert.match(hook, /emitSafeOtelError/);
  assert.match(cron, /code: "CRON_TICK_FAILED"/);
  assert.doesNotMatch(cron, /console\.error\(error\)/);
});
