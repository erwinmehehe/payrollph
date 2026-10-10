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
