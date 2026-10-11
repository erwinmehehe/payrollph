import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { newOperationalRequestId, schedulerOpsRecord } from "../src/lib/ops-telemetry";

test("scheduler event is structured, correlated, duration bounded and no request payload is accepted", () => {
  const requestId = newOperationalRequestId();
  const entry = schedulerOpsRecord({ requestId, state: "cron-completed", durationMs: 320.6 });
  assert.match(entry.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(entry.event, "scheduler_cron");
  assert.equal(entry.requestId, requestId);
  assert.equal(entry.durationMs, 321);
  assert.deepEqual(Object.keys(entry).sort(), ["durationMs", "event", "requestId", "state", "timestamp"].sort());
  assert.equal(schedulerOpsRecord({ requestId, state: "cron-error", durationMs: Infinity }).durationMs, 0);
  assert.equal(schedulerOpsRecord({ requestId, state: "cron-error", durationMs: 9999999 }).durationMs, 600000);
});

test("cron endpoint emits telemetry and request ID without exposing stack or secrets", () => {
  const source = readFileSync("src/app/api/jobs/cron/route.ts", "utf8");
  assert.ok(source.includes("newOperationalRequestId()"));
  assert.ok(source.includes('"X-Request-ID": requestId'));
  assert.ok(source.includes('emit("cron-error")'));
  assert.ok(source.includes('emit(result.skipped ? "cron-skipped" : "cron-completed")'));
  assert.ok(!source.includes("console.error(error)"));
  assert.ok(!source.includes("console.log(request)"));
  const misconfigured = source.split('if (auth === "misconfigured") {')[1]?.split("\n  }")[0];
  assert.ok(misconfigured && !misconfigured.includes("emit("), "unauthenticated missing-secret probes must not flood logs");
});

test("event logger has no pathway to embed names, bank accounts or free text", () => {
  const record = schedulerOpsRecord({
    requestId: "Forged customer name and bank account 1234",
    state: "cron-skipped", durationMs: -100,
  });
  assert.equal(record.requestId, "invalid");
  assert.equal(record.durationMs, 0);
  assert.ok(!JSON.stringify(record).includes("customer name"));
});

test("scheduler logger discards forged state text and non-v4 correlation IDs at runtime", () => {
  const forged = schedulerOpsRecord({
    requestId: "a".repeat(36),
    state: "employee bank account details" as never,
    durationMs: 1.25,
  });
  assert.equal(forged.requestId, "invalid");
  assert.equal(forged.state, "cron-error");
  assert.equal(forged.durationMs, 1);
  assert.ok(!JSON.stringify(forged).includes("employee bank account"));
  assert.equal(schedulerOpsRecord({
    requestId: "12345678-1234-1234-1234-123456789abc",
    state: "cron-started", durationMs: 0,
  }).requestId, "invalid", "a UUID-shaped value is not necessarily the generated UUIDv4");
});
