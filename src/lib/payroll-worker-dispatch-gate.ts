import { db } from "@/db";
import { schedulerState } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  PAYROLL_WORKER_HEARTBEAT_JOB,
  evaluatePayrollWorkerHeartbeat,
  payrollWorkerHeartbeatPolicy,
} from "@/lib/payroll-worker-health";

export type PayrollWorkerGateState =
  | "not-required" | "healthy" | "never-ran" | "overdue"
  | "invalid-clock" | "invalid-policy" | "heartbeat-not-required"
  | "monitor-unavailable";

/**
 * Side-effect-free, fail-closed production preflight.
 * Vercel production never accepts scheduler ticks unless the separate payroll
 * worker has been explicitly required and recently observed in PostgreSQL.
 * Synthetic localhost CI continues to exercise OFF -> ON -> OFF without
 * needing a production worker or an external monitoring service.
 */
export async function checkPayrollWorkerDispatchGate(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<{ ok: boolean; state: PayrollWorkerGateState }> {
  const policy = payrollWorkerHeartbeatPolicy(env);
  if (policy === "invalid") return { ok: false, state: "invalid-policy" };
  if (env.VERCEL_ENV === "production" && policy !== "required") {
    return { ok: false, state: "heartbeat-not-required" };
  }
  if (policy === "off") return { ok: true, state: "not-required" };
  try {
    const rows = await db.select({ lastRunAt: schedulerState.lastRunAt })
      .from(schedulerState)
      .where(eq(schedulerState.jobName, PAYROLL_WORKER_HEARTBEAT_JOB))
      .limit(1);
    const state = evaluatePayrollWorkerHeartbeat({ lastSeen: rows[0]?.lastRunAt ?? null });
    return { ok: state.ok, state: state.state };
  } catch {
    return { ok: false, state: "monitor-unavailable" };
  }
}
