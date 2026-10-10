import { getSessionUser } from "@/lib/auth";
import {
  bpMonitorJson, denyBpMonitor, positiveBpMonitorId,
} from "@/lib/hcm-business-process-monitor-access";
import {
  parseBpMonitorCursor, validBpMonitorFilter,
} from "@/lib/hcm-business-process-monitor-projection";
import { loadBpMonitorList } from "@/lib/hcm-business-process-monitor-server";

export const dynamic = "force-dynamic";

/** A read-only, paginated view of previously governed HCM transactions. */
export async function GET(request: Request) {
  if (process.env.HCM_BP_MONITOR_ENABLED !== "true") {
    return bpMonitorJson({ error: "Not found." }, 404);
  }
  const user = await getSessionUser();
  if (!user) return bpMonitorJson({ error: "Authentication required." }, 401);

  const params = new URL(request.url).searchParams;
  const organizationId = positiveBpMonitorId(params.get("organizationId"));
  if (!organizationId) return bpMonitorJson({ error: "Valid organizationId required." }, 400);
  const status = params.get("status") ?? "all";
  if (!validBpMonitorFilter(status)) return bpMonitorJson({ error: "Invalid status filter." }, 400);
  const rawCursor = params.get("cursor");
  const cursor = rawCursor === null ? null : parseBpMonitorCursor(rawCursor);
  if (rawCursor !== null && cursor === null) return bpMonitorJson({ error: "Invalid cursor." }, 400);

  const denied = await denyBpMonitor(user.id, organizationId);
  if (denied) return denied;

  try {
    return bpMonitorJson(await loadBpMonitorList(organizationId, status, cursor));
  } catch {
    return bpMonitorJson({ error: "Workflow monitor source temporarily unavailable." }, 503);
  }
}
