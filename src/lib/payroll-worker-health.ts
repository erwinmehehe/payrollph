/**
 * Liveness for the separately hosted payroll queue worker.
 *
 * A central scheduler tick does NOT process payroll_jobs. A scheduler
 * heartbeat must not be presented as evidence that the payroll worker exists.
 * Only metadata is exposed; no employee, bank or job contents are read.
 */
export const PAYROLL_WORKER_HEARTBEAT_JOB = "payroll-queue-worker-heartbeat";
const DEFAULT_STALE_AFTER_MS = 10 * 60_000;

export type PayrollWorkerHeartbeatHealth = {
  ok: boolean;
  state: "healthy" | "never-ran" | "overdue" | "invalid-clock";
  secondsSinceHeartbeat: number | null;
};

export function payrollWorkerHeartbeatPolicy(
  env: Readonly<Record<string, string | undefined>> = process.env,
): "off" | "required" | "invalid" {
  const value = env.PAYROLL_WORKER_HEARTBEAT_REQUIRED;
  if (value === undefined || value === "false") return "off";
  return value === "true" ? "required" : "invalid";
}

export function evaluatePayrollWorkerHeartbeat(input: {
  lastSeen?: Date | null;
  now?: Date;
  staleAfterMs?: number;
}): PayrollWorkerHeartbeatHealth {
  const now = (input.now ?? new Date()).getTime();
  const staleAfterMs = input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  if (!Number.isFinite(now) || !Number.isSafeInteger(staleAfterMs) ||
      staleAfterMs < 60_000 || staleAfterMs > 60 * 60_000) {
    return { ok: false, state: "invalid-clock", secondsSinceHeartbeat: null };
  }
  const last = input.lastSeen?.getTime() ?? NaN;
  if (!Number.isFinite(last)) {
    return { ok: false, state: "never-ran", secondsSinceHeartbeat: null };
  }
  const age = now - last;
  if (!Number.isFinite(age) || age < 0) {
    return { ok: false, state: "invalid-clock", secondsSinceHeartbeat: null };
  }
  return {
    ok: age <= staleAfterMs,
    state: age <= staleAfterMs ? "healthy" : "overdue",
    secondsSinceHeartbeat: Math.floor(age / 1000),
  };
}
