import { getSessionUser } from "@/lib/auth";
import { getAccess, assertMembership } from "@/lib/access";
import { db } from "@/db";
import { schedulerState } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { evaluateSchedulerLiveness } from "@/lib/scheduler-liveness";
import { isCentralSchedulerEnabled } from "@/lib/scheduler-activation";

export const dynamic = "force-dynamic";

/** Session-protected, owner/admin-only global scheduler status. No worker secrets. */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "Valid organization required." }, { status: 400 });
  }
  const denied = await assertMembership(user.id, organizationId);
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide || !["owner", "admin"].includes(access.role)) {
    return Response.json({ error: "Owner or company administrator required." }, { status: 403 });
  }
  const headers = { "Cache-Control": "private, no-store" };
  if (!isCentralSchedulerEnabled()) {
    return Response.json({ ok: false, state: "scheduler-disabled", lastRanMinutesAgo: null }, { headers });
  }
  try {
    const rows = await db.select({
      jobName: schedulerState.jobName,
      lastRunAt: schedulerState.lastRunAt,
      lastResult: schedulerState.lastResult,
    }).from(schedulerState).where(inArray(schedulerState.jobName, [
      "delivery-drain", "central-scheduler-lease",
    ]));
    const completed = rows.find(row => row.jobName === "delivery-drain");
    const lease = rows.find(row => row.jobName === "central-scheduler-lease");
    const result = lease?.lastResult && typeof lease.lastResult === "object" && !Array.isArray(lease.lastResult)
      ? lease.lastResult as Record<string, unknown> : {};
    const status = result.status === "running" || result.status === "completed" || result.status === "failed"
      ? result.status : null;
    const state = evaluateSchedulerLiveness({
      lastSuccessfulRunAt: completed?.lastRunAt ?? null,
      lastLeaseStatus: status,
    });
    return Response.json({
      ok: state.ok, state: state.state,
      lastRanMinutesAgo: state.secondsSinceSuccess === null ? null : Math.floor(state.secondsSinceSuccess / 60),
    }, { headers });
  } catch {
    return Response.json({ ok: false, state: "monitor-unavailable", lastRanMinutesAgo: null }, { headers });
  }
}
