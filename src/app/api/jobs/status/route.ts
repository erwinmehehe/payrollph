import { db } from "@/db";
import { inArray } from "drizzle-orm";
import { schedulerState } from "@/db/schema";
import { constantTimeSecretEqual } from "@/lib/security-secret";
import { operationalSecret } from "@/lib/operational-secret";
import { evaluateSchedulerLiveness } from "@/lib/scheduler-liveness";
import { isCentralSchedulerEnabled } from "@/lib/scheduler-activation";

export const dynamic = "force-dynamic";

/**
 * Read-only operations endpoint. This is NOT an anonymous liveness probe.
 * A least-privileged, separately configured monitor credential can alert on HTTP 503.
 * The endpoint never starts scheduler work or leaks tenant/task payloads.
 */
export async function GET(request: Request) {
  // Read-only credentials MUST NOT grant POST /api/jobs/tick permission.
  // Never fall back to the worker token or an authentication master key.
  const expected = process.env.SCHEDULER_MONITOR_TOKEN?.trim();
  if (!expected || Buffer.byteLength(expected, "utf8") < 32) {
    return Response.json({ error: "A dedicated scheduler monitor token is required." }, { status: 503 });
  }
  try {
    if (constantTimeSecretEqual(expected, operationalSecret("worker"))) {
      return Response.json({ error: "The monitor and worker credentials must be distinct." }, { status: 503 });
    }
  } catch {
    return Response.json({ error: "Worker credential configuration could not be verified." }, { status: 503 });
  }
  if (!constantTimeSecretEqual(request.headers.get("x-scheduler-monitor-token"), expected)) {
    return Response.json({ error: "Authorized scheduler monitor token required." }, { status: 401 });
  }
  // An old successful delivery receipt must never make a deliberately
  // disabled scheduler appear healthy. Check only after monitor auth.
  if (!isCentralSchedulerEnabled()) {
    return Response.json({ ok: false, state: "scheduler-disabled" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  try {
    const rows = await db.select({
      jobName: schedulerState.jobName,
      lastRunAt: schedulerState.lastRunAt,
      lastResult: schedulerState.lastResult,
    }).from(schedulerState).where(inArray(schedulerState.jobName, [
      "delivery-drain", "central-scheduler-lease",
    ]));
    const completed = rows.find((row) => row.jobName === "delivery-drain");
    const lease = rows.find((row) => row.jobName === "central-scheduler-lease");
    const result = lease?.lastResult && typeof lease.lastResult === "object" && !Array.isArray(lease.lastResult)
      ? lease.lastResult as Record<string, unknown>
      : {};
    // Emit only documented states; never expose arbitrary stored JSON strings.
    const lastLeaseStatus = result.status === "running" || result.status === "completed" || result.status === "failed"
      ? result.status : null;
    const state = evaluateSchedulerLiveness({
      lastSuccessfulRunAt: completed?.lastRunAt ?? null,
      lastLeaseStatus,
    });
    return Response.json(state, {
      status: state.ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ ok: false, state: "monitor-unavailable" }, { status: 503 });
  }
}
