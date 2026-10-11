import { randomUUID } from "node:crypto";

/**
 * Restricted structured operational telemetry. Never log arbitrary Error,
 * request headers, JSON payloads, employee or bank data. Only enum outcomes
 * and bounded numeric timings may enter scheduler observability.
 */
export type SchedulerOpsState = "cron-started" | "cron-completed" | "cron-skipped" |
  "cron-error" | "cron-misconfigured" | "cron-disabled";

const ALLOWED_SCHEDULER_STATES: ReadonlySet<string> = new Set<SchedulerOpsState>([
  "cron-started", "cron-completed", "cron-skipped",
  "cron-error", "cron-misconfigured", "cron-disabled",
]);
// Only a freshly generated v4 UUID is accepted as a correlation identifier.
const OPERATIONAL_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    requestId: OPERATIONAL_UUID_V4.test(input.requestId) ? input.requestId : "invalid",
    // TypeScript is erased at runtime; reject forged free-text states too.
    state: ALLOWED_SCHEDULER_STATES.has(input.state) ? input.state : "cron-error",
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
