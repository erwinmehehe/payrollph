import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dispatchSchedulerTick, schedulerDispatchConfig } from "../scripts/run-external-scheduler-tick.mjs";

const enabled = {
  PAYROLL_SCHEDULER_DISPATCH_ENABLED: "true",
  PAYROLL_SCHEDULER_ORIGIN: "https://payroll.example.com",
  PAYROLL_SCHEDULER_EXPECTED_HOST: "payroll.example.com",
  PAYROLL_SCHEDULER_WORKER_TOKEN: "a".repeat(48),
};
const json = (result, status = 200) => ({
  ok: status < 300,
  status,
  headers: new Headers({ "content-type": "application/json" }),
  json: async () => ({ scheduler: "worker-triggered", result }),
});

test("scheduler is inert until the exact production dispatch flag is true", async () => {
  for (const flag of [undefined, "", "false", "TRUE", "1"]) {
    let called = false;
    const result = await dispatchSchedulerTick({
      env: { PAYROLL_SCHEDULER_DISPATCH_ENABLED: flag },
      fetchImpl: async () => { called = true; throw new Error("must not run"); },
    });
    assert.equal(result.outcome, "dispatch-disabled");
    assert.equal(called, false);
  }
});

test("validates exact approved HTTPS origin, host and secret before network access", () => {
  for (const changes of [
    { PAYROLL_SCHEDULER_ORIGIN: "http://payroll.example.com" },
    { PAYROLL_SCHEDULER_ORIGIN: "https://payroll.example.com.evil.test" },
    { PAYROLL_SCHEDULER_ORIGIN: "https://payroll.example.com/admin" },
    { PAYROLL_SCHEDULER_ORIGIN: "https://user:pw@payroll.example.com" },
    { PAYROLL_SCHEDULER_ORIGIN: "https://payroll.example.com?secret=1" },
    { PAYROLL_SCHEDULER_ORIGIN: "https://payroll.example.com:444" },
    { PAYROLL_SCHEDULER_EXPECTED_HOST: "different.example.com" },
    { PAYROLL_SCHEDULER_WORKER_TOKEN: "too-short" },
    { PAYROLL_SCHEDULER_WORKER_TOKEN: "b".repeat(32) + "\n" },
  ]) assert.throws(() => schedulerDispatchConfig({ ...enabled, ...changes }));
});

test("makes exactly one authenticated POST and accepts only acknowledged scheduler states", async () => {
  let calls = 0;
  const output = await dispatchSchedulerTick({
    env: enabled,
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, "https://payroll.example.com/api/jobs/tick");
      assert.equal(options.method, "POST");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers["x-worker-token"], enabled.PAYROLL_SCHEDULER_WORKER_TOKEN);
      assert.equal(options.headers.accept, "application/json");
      return json({ skipped: false });
    },
  });
  assert.equal(calls, 1);
  assert.equal(output.outcome, "tick-acknowledged");

  const busy = await dispatchSchedulerTick({
    env: enabled,
    fetchImpl: async () => json({ skipped: true, reason: "another-worker" }),
  });
  assert.equal(busy.outcome, "lease-or-interval-skipped");
});

test("disabled, failed, redirected or unexpected replies cannot be marked successful", async () => {
  for (const response of [
    json({ skipped: true, reason: "scheduler-disabled" }, 503),
    json({ skipped: true, reason: "scheduler-disabled" }),
    json({ skipped: true, reason: "unknown" }),
    { ...json({}), json: async () => ({ ok: true }) },
    { ...json({}), headers: new Headers({ "content-type": "text/html" }) },
  ]) await assert.rejects(dispatchSchedulerTick({ env: enabled, fetchImpl: async () => response }));
});

test("production workflow is main-only, least-privileged, scheduled and independently gated", () => {
  const workflow = readFileSync(".github/workflows/production-scheduler-tick.yml", "utf8");
  assert.match(workflow, /cron:\s*"\*\/5 \* \* \* \*"/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: payroll-scheduler-production/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /PAYROLL_SCHEDULER_DISPATCH_ENABLED:.*vars\.PAYROLL_SCHEDULER_DISPATCH_ENABLED/);
  assert.doesNotMatch(workflow, /pull_request:/);
});
