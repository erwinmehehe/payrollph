#!/usr/bin/env node
/**
 * External always-on monitor: deploy separately from PayrollPH worker/web app.
 * This process NEVER triggers a scheduled job and has no database credentials.
 * An external uptime monitor must independently supervise this watchdog.
 */
import { setTimeout as pause } from "node:timers/promises";
import {
  createSchedulerWatchdog,
  schedulerWatchdogConfiguration,
} from "./lib/scheduler-watchdog.mjs";

function main() {
  if (process.argv.length !== 2) throw new Error("SCHEDULER_WATCHDOG_ARGUMENTS_INVALID");
  const config = schedulerWatchdogConfiguration(process.env);
  const abort = new AbortController();
  for (const event of ["SIGINT", "SIGTERM"]) {
    process.on(event, () => abort.abort());
  }
  const monitor = createSchedulerWatchdog(config);
  console.info(JSON.stringify({ kind: "scheduler-watchdog-started", label: config.label }));
  return (async () => {
    while (!abort.signal.aborted) {
      const verdict = await monitor.poll();
      // Reasons and states are fixed enums; never log HTTP targets, webhook
      // credentials, remote responses or worker/payroll data.
      console.info(JSON.stringify({
        kind: "scheduler-watchdog-probe",
        label: config.label,
        healthy: verdict.healthy,
        reason: verdict.reason,
        alertOpen: verdict.alertOpen,
        notification: verdict.notification,
      }));
      try {
        await pause(config.pollMs, undefined, { signal: abort.signal });
      } catch {
        if (!abort.signal.aborted) throw new Error("SCHEDULER_WATCHDOG_POLL_TIMER_FAILED");
      }
    }
    console.info(JSON.stringify({ kind: "scheduler-watchdog-stopped", label: config.label }));
  })();
}

Promise.resolve().then(main).catch(() => {
  console.error("SCHEDULER_WATCHDOG_STOPPED: invalid configuration or unexpected runtime error.");
  process.exitCode = 1;
});
