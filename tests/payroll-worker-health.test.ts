import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PAYROLL_WORKER_HEARTBEAT_JOB,
  evaluatePayrollWorkerHeartbeat,
  payrollWorkerHeartbeatPolicy,
} from "../src/lib/payroll-worker-health";

const now = new Date("2026-10-13T10:00:00.000Z");

test("worker heartbeat policy is default-off but rejects malformed activation", () => {
  assert.equal(payrollWorkerHeartbeatPolicy({}), "off");
  assert.equal(payrollWorkerHeartbeatPolicy({ PAYROLL_WORKER_HEARTBEAT_REQUIRED: "false" }), "off");
  assert.equal(payrollWorkerHeartbeatPolicy({ PAYROLL_WORKER_HEARTBEAT_REQUIRED: "true" }), "required");
  for (const value of ["TRUE", "1", "", "tru", " true "]) {
    assert.equal(payrollWorkerHeartbeatPolicy({ PAYROLL_WORKER_HEARTBEAT_REQUIRED: value }), "invalid");
  }
});

test("healthy, absent, stale and clock-invalid independent payroll worker receipts", () => {
  const fresh = evaluatePayrollWorkerHeartbeat({
    now, lastSeen: new Date("2026-10-13T09:58:00.000Z"),
  });
  assert.deepEqual(fresh, { ok: true, state: "healthy", secondsSinceHeartbeat: 120 });
  assert.deepEqual(evaluatePayrollWorkerHeartbeat({ now, lastSeen: null }), {
    ok: false, state: "never-ran", secondsSinceHeartbeat: null,
  });
  const overdue = evaluatePayrollWorkerHeartbeat({
    now, lastSeen: new Date("2026-10-13T09:49:00.000Z"),
  });
  assert.equal(overdue.ok, false);
  assert.equal(overdue.state, "overdue");
  assert.equal(evaluatePayrollWorkerHeartbeat({
    now, lastSeen: new Date("2026-10-13T10:00:01.000Z"),
  }).state, "invalid-clock");
  assert.equal(evaluatePayrollWorkerHeartbeat({
    now, lastSeen: new Date("2026-10-13T09:59:00.000Z"), staleAfterMs: 0,
  }).ok, false);
});

test("only standalone payroll worker publishes a narrowly scoped heartbeat", () => {
  const worker = readFileSync("scripts/worker.ts", "utf8");
  assert.equal(PAYROLL_WORKER_HEARTBEAT_JOB, "payroll-queue-worker-heartbeat");
  assert.match(worker, /WORKER_ENABLED !== "true"/);
  assert.match(worker, /INSERT INTO scheduler_state/);
  assert.match(worker, /ON CONFLICT \(job_name\) DO UPDATE/);
  assert.match(worker, /await publishWorkerHeartbeat\(\)/);
});

test("both scheduler dispatch paths and read-only monitor fail closed on absent worker", () => {
  const gate = readFileSync("src/lib/payroll-worker-dispatch-gate.ts", "utf8");
  assert.match(gate, /env\.VERCEL_ENV === "production" && policy !== "required"/);
  assert.match(gate, /evaluatePayrollWorkerHeartbeat/);
  assert.match(gate, /return \{ ok: false, state: "monitor-unavailable" \}/);
  for (const file of [
    "src/app/api/jobs/dispatch-readiness/route.ts",
    "src/app/api/jobs/cron/route.ts",
    "src/app/api/jobs/status/route.ts",
    "src/app/api/jobs/tick/route.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /await checkPayrollWorkerDispatchGate\(\)/);
  }
  const status = readFileSync("src/app/api/jobs/status/route.ts", "utf8");
  assert.match(status, /status: 503/);
  assert.doesNotMatch(status, /tickScheduler\(/);
});

test("direct authenticated POST cannot skip required worker preflight", () => {
  const route = readFileSync("src/app/api/jobs/tick/route.ts", "utf8");
  const gate = route.indexOf("await checkPayrollWorkerDispatchGate()");
  const tick = route.indexOf("await tickScheduler(true)");
  assert.ok(gate > 0 && tick > gate, "worker gate must run before scheduler mutation");
  assert.match(route, /Payroll worker heartbeat is missing or unhealthy/);
  assert.match(route, /status: 503/);
});
