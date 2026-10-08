import { db } from "@/db";
import { inArray } from "drizzle-orm";
import { schedulerState } from "@/db/schema";
import { constantTimeSecretEqual } from "@/lib/security-secret";
import { operationalSecret } from "@/lib/operational-secret";
import { evaluateSchedulerLiveness } from "@/lib/scheduler-liveness";

export const dynamic = "force-dynamic";

/**
 * Read-only operations endpoint. This is NOT an anonymous liveness probe.
 * An uptime monitor with an approved worker secret can alert on HTTP 503.
 * The endpoint never starts scheduler work or leaks tenant/task payloads.
 */
export async function GET(request: Request) {
  const expected = operationalSecret("worker");
  if (!expected) {
    return Response.json({ error: "Worker authentication is not configured." }, { status: 503 });
  }
  if (!constantTimeSecretEqual(request.headers.get("x-worker-token"), expected)) {
    return Response.json({ error: "Authorized worker monitor token required." }, { status: 401 });
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
    const lastLeaseStatus = typeof result.status === "string" ? result.status : null;
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
