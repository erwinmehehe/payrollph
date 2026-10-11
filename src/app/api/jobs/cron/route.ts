import { cronAuthorization } from "@/lib/scheduler-cron-auth";
import { isCentralSchedulerEnabled } from "@/lib/scheduler-activation";
import { tickScheduler } from "@/lib/scheduler";
import { logSchedulerOps, newOperationalRequestId, type SchedulerOpsState } from "@/lib/ops-telemetry";

export const dynamic = "force-dynamic";

/**
 * Vercel invokes this GET endpoint on the production deployment only.
 * Neither cron installation nor authentication may enable scheduled work:
 * CENTRAL_SCHEDULER_ENABLED remains a separate, default-off release gate.
 */
export async function GET(request: Request) {
  const requestId = newOperationalRequestId();
  const startedAt = Date.now();
  const headers = { "Cache-Control": "no-store", "X-Request-ID": requestId };
  const emit = (state: SchedulerOpsState) => logSchedulerOps({
    requestId, state, durationMs: Date.now() - startedAt,
  });
  const auth = cronAuthorization(request);
  if (auth === "misconfigured") {
    // No trusted caller can be identified without a configured secret.
    // Avoid attacker-triggered per-request error logs; the 503 is monitored.
    return Response.json({ ok: false, error: "Cron credentials are not configured." }, { status: 503, headers });
  }
  if (auth !== "authorized") {
    return Response.json({ ok: false, error: "Unauthorized cron request." }, { status: 401, headers });
  }
  if (!isCentralSchedulerEnabled()) {
    emit("cron-disabled");
    return Response.json({ ok: false, scheduler: "disabled" }, { status: 503, headers });
  }
  try {
    emit("cron-started");
    // Do not force a second immediate cycle after an existing worker's tick.
    // The scheduler's fenced PostgreSQL lease protects concurrent invocations.
    const result = await tickScheduler();
    if (result.skipped && result.reason === "scheduler-disabled") {
      emit("cron-disabled");
      return Response.json({ ok: false, scheduler: "disabled" }, { status: 503, headers });
    }
    emit(result.skipped ? "cron-skipped" : "cron-completed");
    return Response.json({
      ok: true,
      scheduler: "cron-triggered",
      outcome: result.skipped ? "skipped" : "completed",
    }, { headers });
  } catch {
    // The monitor provides a separately authenticated liveness signal;
    // never expose job payloads, tenant data or stack traces here.
    emit("cron-error");
    return Response.json({ ok: false, error: "Scheduler tick failed." }, { status: 503, headers });
  }
}
