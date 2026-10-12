import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  schedulerWatchdogConfiguration, evaluateSchedulerStatus,
  fetchSchedulerLiveness, createSchedulerWatchdog,
} from "../scripts/lib/scheduler-watchdog.mjs";

const fixedNow = Date.parse("2026-10-12T01:00:00.000Z");
const env = {
  SCHEDULER_WATCHDOG_STATUS_URL: "https://payroll.example.test/api/jobs/status",
  SCHEDULER_WATCHDOG_STATUS_HOST: "payroll.example.test",
  SCHEDULER_MONITOR_TOKEN: "synthetic-only-read-monitor-token-at-least-32-bytes",
  SCHEDULER_WATCHDOG_ALERT_URL: "https://hooks.slack.com/services/SYNTHETIC/WEBHOOK/NO-REAL-SECRET",
  SCHEDULER_WATCHDOG_ALERT_HOST: "hooks.slack.com",
  SCHEDULER_WATCHDOG_LABEL: "payrollph-staging",
  SCHEDULER_WATCHDOG_POLL_MS: "60000",
};
const config = schedulerWatchdogConfiguration(env);
function healthy(overrides = {}) {
  return {
    ok: true, state: "healthy",
    lastSuccessfulRunAt: "2026-10-12T00:59:00.000Z",
    secondsSinceSuccess: 60, lastLeaseStatus: "completed",
    ...overrides,
  };
}
function response(body, status = 200, headers = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}
function harness(sequence, options = {}) {
  const observed = [];
  const posts = [];
  let index = 0;
  let failures = 0;
  const fetcher = async (url, request) => {
    observed.push({ method: request.method, url, request });
    if (request.method === "POST") {
      posts.push({ url, body: request.body });
      if (options.failFirstAlert && failures++ === 0) return response({ error: true }, 503);
      return response("ok");
    }
    const next = sequence[Math.min(index++, sequence.length - 1)];
    if (next instanceof Error) throw next;
    // HTTP fetch returns a fresh body on every call. Reusing one consumed
    // Response artificially masks a stale-heartbeat failure as a network error.
    return next instanceof Response ? next.clone() : next;
  };
  return { fetcher, observed, posts };
}

test("configuration pins distinct HTTPS hosts, a read-only token, and bounded polling", () => {
  assert.equal(config.pollMs, 60000);
  assert.equal(config.statusUrl, env.SCHEDULER_WATCHDOG_STATUS_URL);
  assert.equal(config.failurePolls, 2);
  assert.equal(config.recoveryPolls, 2);
  for (const bad of [
    { SCHEDULER_MONITOR_TOKEN: "short" },
    { SCHEDULER_MONITOR_TOKEN: "REPLACE_WITH_SEPARATE_32_BYTE_RANDOM_MONITOR_SECRET" },
    { SCHEDULER_MONITOR_TOKEN: env.SCHEDULER_MONITOR_TOKEN, WORKER_TOKEN: env.SCHEDULER_MONITOR_TOKEN },
    { SCHEDULER_WATCHDOG_STATUS_URL: "http://payroll.example.test/api/jobs/status" },
    { SCHEDULER_WATCHDOG_STATUS_URL: "https://prod.example.test/api/jobs/status" },
    { SCHEDULER_WATCHDOG_STATUS_URL: "https://payroll.example.test/api/jobs/tick" },
    { SCHEDULER_WATCHDOG_STATUS_URL: "https://payroll.example.test/api/jobs/status?token=abc" },
    { SCHEDULER_WATCHDOG_STATUS_URL: "https://evil:secret@payroll.example.test/api/jobs/status" },
    { SCHEDULER_WATCHDOG_STATUS_HOST: "127.0.0.1", SCHEDULER_WATCHDOG_STATUS_URL: "https://127.0.0.1/api/jobs/status" },
    { SCHEDULER_WATCHDOG_ALERT_HOST: "payroll.example.test", SCHEDULER_WATCHDOG_ALERT_URL: "https://payroll.example.test/hooks" },
    { SCHEDULER_WATCHDOG_ALERT_URL: "https://evil.example.test/services" },
    { SCHEDULER_WATCHDOG_POLL_MS: "1000" },
    { SCHEDULER_WATCHDOG_POLL_MS: "NaN" },
    { SCHEDULER_WATCHDOG_LABEL: "production payroll account 123" },
  ]) {
    assert.throws(() => schedulerWatchdogConfiguration({ ...env, ...bad }),
      /SCHEDULER_WATCHDOG_CONFIGURATION_INVALID/);
  }
});

test("only a recent, internally consistent completed lease is healthy", () => {
  assert.deepEqual(evaluateSchedulerStatus(200, healthy(), fixedNow), {
    healthy: true, reason: "healthy",
  });
  for (const payload of [
    healthy({ ok: false }), healthy({ state: "disabled" }),
    healthy({ lastLeaseStatus: "failed" }),
    healthy({ lastLeaseStatus: null }),
    healthy({ secondsSinceSuccess: -1 }),
    healthy({ secondsSinceSuccess: 601 }),
    healthy({ lastSuccessfulRunAt: "not-a-date" }),
    healthy({ secondsSinceSuccess: "60" }),
  ]) assert.equal(evaluateSchedulerStatus(200, payload, fixedNow).healthy, false);
  assert.deepEqual(evaluateSchedulerStatus(503, healthy(), fixedNow), {
    healthy: false, reason: "http-unhealthy",
  });
  assert.equal(evaluateSchedulerStatus(200, healthy(), fixedNow + 15 * 60_000).reason,
    "stale-completion");
  assert.equal(evaluateSchedulerStatus(200, healthy({ secondsSinceSuccess: 59 }), fixedNow).healthy,
    true);
  assert.equal(evaluateSchedulerStatus(200, healthy({ secondsSinceSuccess: 400 }), fixedNow).healthy,
    false, "a server cannot fake a recent timestamp with contradictory age");
});

test("read-only HTTPS status probe sends monitor credential only to pinned endpoint", async () => {
  const h = harness([response(healthy())]);
  assert.deepEqual(await fetchSchedulerLiveness(config, { fetcher: h.fetcher, now: () => fixedNow }),
    { healthy: true, reason: "healthy" });
  assert.equal(h.observed.length, 1);
  const call = h.observed[0];
  assert.equal(call.url, env.SCHEDULER_WATCHDOG_STATUS_URL);
  assert.equal(call.method, "GET");
  assert.equal(call.request.headers["x-scheduler-monitor-token"], env.SCHEDULER_MONITOR_TOKEN);
  assert.equal(call.request.redirect, "error");
  assert.equal(call.request.cache, "no-store");
  assert.equal(h.posts.length, 0);
});

test("oversized, non-JSON, missing-body and network errors never mean healthy", async () => {
  for (const item of [
    response(healthy(), 200, { "content-type": "text/html" }),
    response("not json"),
    response(healthy(), 200, { "content-length": "9000" }),
    new Error("synthetic socket closed"),
  ]) {
    const h = harness([item]);
    const result = await fetchSchedulerLiveness(config, { fetcher: h.fetcher, now: () => fixedNow });
    assert.equal(result.healthy, false);
    assert.equal(result.reason, "network-failure");
  }
});

test("two failures alert exactly once; two healthy responses recover exactly once", async () => {
  const h = harness([
    response(healthy()),
    response({ ok: false, state: "scheduler-disabled" }, 503),
    response({ ok: false, state: "overdue" }, 503),
    response({ ok: false }, 503),
    response(healthy()),
    response(healthy()),
    response(healthy()),
  ]);
  const monitor = createSchedulerWatchdog(config, { fetcher: h.fetcher, now: () => fixedNow });
  assert.equal((await monitor.poll()).notification, "none");
  assert.equal((await monitor.poll()).notification, "none");
  assert.equal((await monitor.poll()).notification, "down-delivered");
  assert.equal((await monitor.poll()).notification, "none");
  assert.equal((await monitor.poll()).notification, "none");
  assert.equal((await monitor.poll()).notification, "recovery-delivered");
  assert.equal((await monitor.poll()).notification, "none");
  assert.equal(h.posts.length, 2);
  assert.match(JSON.parse(h.posts[0].body).text, /DOWN/);
  assert.match(JSON.parse(h.posts[1].body).text, /RECOVERED/);
  for (const post of h.posts) {
    assert.equal(post.url, config.alertUrl);
    assert.ok(!post.body.includes(config.monitorToken));
    assert.ok(!post.body.includes(config.statusUrl));
    assert.ok(!post.body.includes("WORKER_TOKEN"));
  }
  assert.ok(h.observed.filter(x => x.method === "GET").every(x => x.url.endsWith("/api/jobs/status")));
});

test("unacknowledged webhook alert retries and cannot be marked delivered", async () => {
  const h = harness([response({ ok: false }, 503)], { failFirstAlert: true });
  const monitor = createSchedulerWatchdog(config, { fetcher: h.fetcher, now: () => fixedNow });
  assert.equal((await monitor.poll()).notification, "none");
  const first = await monitor.poll();
  assert.equal(first.notification, "down-delivery-failed");
  assert.equal(first.alertOpen, false);
  const retry = await monitor.poll();
  assert.equal(retry.notification, "down-delivered");
  assert.equal(retry.alertOpen, true);
  await monitor.poll();
  assert.equal(h.posts.length, 2, "one failure and one retry, no alert spam thereafter");
});

test("stopped ticks raise an alert even when a cache incorrectly returns HTTP 200", async () => {
  const h = harness([response(healthy())]);
  let now = fixedNow;
  const monitor = createSchedulerWatchdog(config, { fetcher: h.fetcher, now: () => now });
  assert.equal((await monitor.poll()).healthy, true);
  now += 11 * 60_000;
  assert.equal((await monitor.poll()).reason, "stale-completion");
  assert.equal((await monitor.poll()).notification, "down-delivered");
  assert.equal(h.posts.length, 1);
});

test("managed worker and alert container manifests keep activation off by default", () => {
  const workerImage = readFileSync("deploy/scheduler/worker.Dockerfile", "utf8");
  const watchdogImage = readFileSync("deploy/scheduler/watchdog.Dockerfile", "utf8");
  const workerCompose = readFileSync("deploy/scheduler/worker.compose.yml", "utf8");
  const watchdogCompose = readFileSync("deploy/scheduler/watchdog.compose.yml", "utf8");
  const workerEnv = readFileSync("deploy/scheduler/worker.env.example", "utf8");
  const watchdogEnv = readFileSync("deploy/scheduler/watchdog.env.example", "utf8");
  const app = readFileSync("vercel.json", "utf8");
  assert.match(workerImage, /node", "--import", "tsx", "scripts\/worker.ts"/);
  assert.match(workerCompose, /restart: unless-stopped/);
  assert.match(watchdogCompose, /restart: unless-stopped/);
  assert.match(watchdogImage, /node", "scripts\/scheduler-watchdog.mjs"/);
  assert.match(workerEnv, /^WORKER_ENABLED=false$/m);
  assert.match(workerEnv, /^CENTRAL_SCHEDULER_ENABLED=false$/m);
  assert.ok(!workerCompose.includes("CENTRAL_SCHEDULER_ENABLED: true"));
  assert.ok(!watchdogCompose.includes("DATABASE_URL"));
  assert.ok(!watchdogEnv.includes("WORKER_TOKEN"));
  assert.equal(JSON.parse(app).crons, undefined,
    "Vercel Hobby must not gain a five-minute cron without an approved plan upgrade");
});
