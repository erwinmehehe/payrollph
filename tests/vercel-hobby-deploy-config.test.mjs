import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Hobby production config omits unsupported frequent Vercel cron scheduling", () => {
  const config = JSON.parse(readFileSync("vercel.json", "utf8"));
  assert.equal(config.git?.deploymentEnabled?.main, true, "main must remain the production deployment branch");
  assert.equal(config.crons, undefined,
    "The payrollph Hobby project cannot deploy a five-minute Vercel Cron. Do not add any cron until the team plan and scheduler rollout are reviewed.");
});

test("central scheduler continues to require an explicit activation gate", () => {
  const source = readFileSync("src/lib/scheduler-activation.ts", "utf8");
  const endpoint = readFileSync("src/app/api/jobs/cron/route.ts", "utf8");
  assert.match(source, /criticalReleaseFlagEnabled\("centralScheduler", env\)/);
  assert.match(endpoint, /cronAuthorization\(request\)/);
  assert.match(endpoint, /isCentralSchedulerEnabled\(\)/);
  assert.match(endpoint, /status: 503/);
});
