import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dispatchSchedulerTick, schedulerDispatchConfig } from "../scripts/run-external-scheduler-tick.mjs";

const sha = "c".repeat(40);
const enabled = {
  PAYROLL_SCHEDULER_DISPATCH_ENABLED: "true",
  PAYROLL_SCHEDULER_ORIGIN: "https://payroll.example.com",
  PAYROLL_SCHEDULER_EXPECTED_HOST: "payroll.example.com",
  PAYROLL_SCHEDULER_EXPECTED_DEPLOYMENT_SHA: sha,
  PAYROLL_SCHEDULER_WORKER_TOKEN: "a".repeat(48),
};
const response = (body, status = 200, contentType = "application/json") => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers({ "content-type": contentType }),
  json: async () => body,
});
const ready = (deploymentSha = sha) => response({ ok: true, scheduler: "enabled", deploymentSha });
const accepted = (result, status = 200) => response({ scheduler: "worker-triggered", result }, status);

test("disabled dispatcher makes no network calls even with no deployment secrets", async () => {
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

test("requires a pinned deployed commit and strict approved HTTPS origin", () => {
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
    { PAYROLL_SCHEDULER_EXPECTED_DEPLOYMENT_SHA: "" },
    { PAYROLL_SCHEDULER_EXPECTED_DEPLOYMENT_SHA: "d".repeat(39) },
    { PAYROLL_SCHEDULER_EXPECTED_DEPLOYMENT_SHA: "g".repeat(40) },
  ]) assert.throws(() => schedulerDispatchConfig({ ...enabled, ...changes }));
});

test("preflights reviewed live commit before exactly one authenticated mutating POST", async () => {
  const calls = [];
  const output = await dispatchSchedulerTick({
    env: enabled,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      assert.equal(options.redirect, "error");
      assert.equal(options.headers["x-worker-token"], enabled.PAYROLL_SCHEDULER_WORKER_TOKEN);
      if (options.method === "GET") {
        assert.equal(url, "https://payroll.example.com/api/jobs/dispatch-readiness");
        return ready();
      }
      assert.equal(url, "https://payroll.example.com/api/jobs/tick");
      assert.equal(options.method, "POST");
      assert.equal(options.headers["x-scheduler-deployment-sha"], sha);
      assert.equal(options.headers.accept, "application/json");
      return accepted({ skipped: false });
    },
  });
  assert.deepEqual(calls.map(x => x.options.method), ["GET", "POST"]);
  assert.equal(output.outcome, "tick-acknowledged");
});

test("stale, disabled, unauthorized and unavailable releases cannot trigger jobs", async () => {
  for (const receipt of [
    ready("d".repeat(40)),
    response({ ok: false, scheduler: "disabled", deploymentSha: sha }),
    response({ ok: true, scheduler: "enabled", deploymentSha: null }),
    response({ error: "Not found" }, 404),
    response({ error: "Unauthorized" }, 401),
    response({ ok: true }, 200, "text/html"),
  ]) {
    let posted = false;
    await assert.rejects(dispatchSchedulerTick({
      env: enabled,
      fetchImpl: async (_, options) => {
        if (options.method === "POST") posted = true;
        return receipt;
      },
    }));
    assert.equal(posted, false, "preflight rejection must prevent any POST");
  }
});

test("one permitted skip is acknowledged; no failed or unexpected tick is a success", async () => {
  const competing = await dispatchSchedulerTick({
    env: enabled,
    fetchImpl: async (_, options) => options.method === "GET"
      ? ready() : accepted({ skipped: true, reason: "another-worker" }),
  });
  assert.equal(competing.outcome, "lease-or-interval-skipped");

  for (const receipt of [
    accepted({ skipped: true, reason: "scheduler-disabled" }, 503),
    accepted({ skipped: true, reason: "scheduler-disabled" }),
    accepted({ skipped: true, reason: "unknown" }),
    response({ ok: true }),
    response({ scheduler: "worker-triggered", result: {} }, 200, "text/html"),
  ]) await assert.rejects(dispatchSchedulerTick({
    env: enabled,
    fetchImpl: async (_, options) => options.method === "GET" ? ready() : receipt,
  }));
});

test("workflow is main-only, least-privileged, serial and commit-pinned", () => {
  const workflow = readFileSync(".github/workflows/production-scheduler-tick.yml", "utf8");
  assert.match(workflow, /cron:\s*"\*\/5 \* \* \* \*"/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: payroll-scheduler-production/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /PAYROLL_SCHEDULER_DISPATCH_ENABLED:.*vars\.PAYROLL_SCHEDULER_DISPATCH_ENABLED/);
  assert.match(workflow, /PAYROLL_SCHEDULER_EXPECTED_DEPLOYMENT_SHA:.*github\.sha/);
  assert.doesNotMatch(workflow, /pull_request:/);
});

test("deployed release handshake is side-effect-free and the POST fences alias races", () => {
  const handshake = readFileSync("src/app/api/jobs/dispatch-readiness/route.ts", "utf8");
  const tick = readFileSync("src/app/api/jobs/tick/route.ts", "utf8");
  assert.match(handshake, /constantTimeSecretEqual/);
  assert.match(handshake, /process\.env\.WORKER_TOKEN/);
  assert.match(handshake, /isCentralSchedulerEnabled\(\)/);
  assert.match(handshake, /VERCEL_GIT_COMMIT_SHA/);
  assert.doesNotMatch(handshake, /tickScheduler|db\.execute|db\.insert|db\.update/);
  assert.match(tick, /x-scheduler-deployment-sha/);
  assert.match(tick, /VERCEL_GIT_COMMIT_SHA/);
  assert.match(tick, /constantTimeSecretEqual\(claimedSha, deployedSha\)/);
});
