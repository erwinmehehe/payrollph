import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);

test("authenticated tick executes real heartbeat gate before scheduler mutation", async () => {
  const saved = { ...process.env };
  process.env.DATABASE_URL ??= "postgresql://local:local@127.0.0.1:1/offline";
  const restorers: Array<() => void> = [];
  function patch(path: string, overrides: Record<string, unknown>) {
    const id = require.resolve(path);
    const original = require(id);
    const entry = require.cache[id]!;
    entry.exports = { ...original, ...overrides };
    restorers.push(() => { entry.exports = original; });
  }
  let lastRunAt: Date | null = null;
  let unavailable = false;
  let calls = 0;
  patch("../src/db", { db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => {
    if (unavailable) throw new Error("Synthetic outage");
    return lastRunAt ? [{ lastRunAt }] : [];
  } }) }) }) } });
  patch("../src/lib/scheduler", { tickScheduler: async () => { calls++; return { skipped: false }; } });
  try {
    Object.assign(process.env, { NODE_ENV: "production" });
    process.env.VERCEL_ENV = "production";
    process.env.WORKER_TOKEN = "fictional-worker-token-32-bytes-long";
    process.env.PAYROLL_WORKER_HEARTBEAT_REQUIRED = "true";
    const { POST } = await import("../src/app/api/jobs/tick/route");
    const request = (authenticated = true) => new Request("https://example.test/api/jobs/tick", {
      method: "POST", headers: authenticated ? { "x-worker-token": process.env.WORKER_TOKEN! } : {},
    });
    assert.equal((await POST(request(false))).status, 401);
    for (const date of [null, new Date(Date.now() - 601_000), new Date(Date.now() + 60_000)]) {
      lastRunAt = date;
      assert.equal((await POST(request())).status, 503);
      assert.equal(calls, 0);
    }
    unavailable = true;
    assert.equal((await POST(request())).status, 503);
    assert.equal(calls, 0);
    unavailable = false;
    lastRunAt = new Date();
    assert.equal((await POST(request())).status, 200);
    assert.equal(calls, 1);
    delete process.env.PAYROLL_WORKER_HEARTBEAT_REQUIRED;
    assert.equal((await POST(request())).status, 503);
    assert.equal(calls, 1);
    process.env.VERCEL_ENV = "preview";
    assert.equal((await POST(request())).status, 200);
    assert.equal(calls, 2);
  } finally {
    for (const restore of restorers.reverse()) restore();
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
