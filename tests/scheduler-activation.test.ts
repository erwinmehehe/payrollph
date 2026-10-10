import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isCentralSchedulerEnabled } from "../src/lib/scheduler-activation";

test("central scheduler is disabled unless a separate exact activation flag is true", () => {
  for (const value of [undefined, "", "false", "TRUE", "True", "1", "yes", " true "]) {
    assert.equal(isCentralSchedulerEnabled(
      value === undefined ? {} : { CENTRAL_SCHEDULER_ENABLED: value },
    ), false, "unexpected activation from " + String(value));
  }
  assert.equal(isCentralSchedulerEnabled({CENTRAL_SCHEDULER_ENABLED:"true"}), true);
  assert.equal(isCentralSchedulerEnabled({CENTRAL_SCHEDULER_ENABLED:"false"}), false);
});

test("worker and forced /api/jobs/tick share the default-off scheduler entrypoint", () => {
  const scheduler = readFileSync("src/lib/scheduler.ts", "utf8");
  const worker = readFileSync("scripts/worker.ts", "utf8");
  const tickRoute = readFileSync("src/app/api/jobs/tick/route.ts", "utf8");
  const guard = scheduler.indexOf("if (!isCentralSchedulerEnabled())");
  const acquire = scheduler.indexOf("await acquireSchedulerLease(ownerToken)");
  assert.ok(guard >= 0 && acquire > guard,
    "activation must be checked before any lease / scheduled job");
  assert.ok(scheduler.includes('reason: "scheduler-disabled"'));
  assert.ok(worker.includes("await tickScheduler()"));
  assert.ok(tickRoute.includes("await tickScheduler(true)"));
  assert.ok(tickRoute.includes('result.reason === "scheduler-disabled"'));
  assert.match(tickRoute.slice(tickRoute.indexOf('result.reason === "scheduler-disabled"')),
    /status:\s*503/);
  assert.ok(!tickRoute.includes("runScheduledCompensationGovernance("));
});

test("monitor remains authorized, but disabled scheduling always reports 503", () => {
  const route = readFileSync("src/app/api/jobs/status/route.ts", "utf8");
  const auth = route.indexOf('request.headers.get("x-scheduler-monitor-token")');
  const guard = route.indexOf("if (!isCentralSchedulerEnabled())");
  const dbRead = route.indexOf("const rows = await db.select");
  assert.ok(auth >= 0 && guard > auth && dbRead > guard,
    "only authenticated monitors learn the disabled state, before stale DB reads");
  assert.ok(route.includes('state: "scheduler-disabled"'));
  assert.match(route.slice(guard, dbRead), /status:\s*503/);
  assert.ok(!route.includes("tickScheduler("));
});

test("disabled central scheduler returns skipped even for forced ticks without a lease", async () => {
  const original = process.env.CENTRAL_SCHEDULER_ENABLED;
  try {
    process.env.CENTRAL_SCHEDULER_ENABLED = "false";
    const { tickScheduler } = await import("../src/lib/scheduler");
    assert.deepEqual(await tickScheduler(true), {
      skipped: true, reason: "scheduler-disabled",
    });
  } finally {
    if (original === undefined) delete process.env.CENTRAL_SCHEDULER_ENABLED;
    else process.env.CENTRAL_SCHEDULER_ENABLED = original;
  }
});
