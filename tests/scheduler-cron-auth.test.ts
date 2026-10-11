import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { cronAuthorization } from "../src/lib/scheduler-cron-auth";

const strong = "a-real-deployment-uses-a-random-secret-of-at-least-32-bytes";
const request = (value?: string) => new Request("https://payroll.example/api/jobs/cron", {
  headers: value ? { authorization: value } : {},
});

test("cron only accepts the exact bearer token from the dedicated strong secret", () => {
  assert.equal(cronAuthorization(request(`Bearer ${strong}`), { CRON_SECRET: strong }), "authorized");
  for (const value of [undefined, strong, `Bearer ${strong}-forged`, "Bearer wrong", "Basic credentials"]) {
    assert.equal(cronAuthorization(request(value), { CRON_SECRET: strong }), "unauthorized");
  }
});

test("missing, short or malformed cron secrets cannot turn on the scheduler", () => {
  for (const secret of [undefined, "", "short", "a".repeat(31), "x".repeat(32) + "\n"]) {
    assert.equal(cronAuthorization(request(`Bearer ${secret ?? ""}`), { CRON_SECRET: secret }), "misconfigured");
  }
});

test("cron is scheduled separately and stays behind the explicit activation gate", () => {
  const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    crons: Array<{ path: string; schedule: string }>;
  };
  assert.deepEqual(config.crons, [{ path: "/api/jobs/cron", schedule: "*/5 * * * *" }]);
  const route = readFileSync("src/app/api/jobs/cron/route.ts", "utf8");
  assert.ok(route.includes("cronAuthorization(request)"));
  const auth = route.indexOf('if (auth !== "authorized")');
  const activation = route.indexOf("if (!isCentralSchedulerEnabled())");
  const trigger = route.indexOf("await tickScheduler()");
  assert.ok(auth >= 0 && activation > auth && trigger > activation,
    "cron must authenticate and pass the scheduler kill switch before running any job");
  assert.ok(!route.includes("WORKER_TOKEN"));
  assert.ok(!route.includes("getSessionUser"));
});
