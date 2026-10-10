import { randomUUID } from "node:crypto";

/**
 * Restricted structured operational telemetry. Never log arbitrary Error,
 * request headers, JSON payloads, employee or bank data. Only enum outcomes
 * and bounded numeric timings may enter scheduler observability.
 */
export type SchedulerOpsState = "cron-started" | "cron-completed" | "cron-skipped" |
  "cron-error" | "cron-misconfigured" | "cron-disabled";

export function newOperationalRequestId(): string {
  return randomUUID();
}

export function schedulerOpsRecord(input: {
  requestId: string;
  state: SchedulerOpsState;
  durationMs: number;
}): {
  timestamp: string;
  event: "scheduler_cron";
  requestId: string;
  state: SchedulerOpsState;
  durationMs: number;
} {
  return {
    timestamp: new Date().toISOString(),
    event: "scheduler_cron",
    requestId: /^[a-f0-9-]{36}$/i.test(input.requestId) ? input.requestId : "invalid",
    state: input.state,
    durationMs: Number.isFinite(input.durationMs)
      ? Math.min(600_000, Math.max(0, Math.round(input.durationMs))) : 0,
  };
}

export function logSchedulerOps(input: Parameters<typeof schedulerOpsRecord>[0]) {
  const record = schedulerOpsRecord(input);
  if (record.state === "cron-error" || record.state === "cron-misconfigured") {
    console.error(JSON.stringify(record));
  } else {
    console.info(JSON.stringify(record));
  }
}
