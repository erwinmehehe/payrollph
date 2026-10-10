import { getSessionUser } from "@/lib/auth";
import {
  bpMonitorJson, denyBpMonitor, positiveBpMonitorId,
} from "@/lib/hcm-business-process-monitor-access";
import { loadBpMonitorDetail } from "@/lib/hcm-business-process-monitor-server";

export const dynamic = "force-dynamic";

/** Source step evidence, with no decision/approval/mutation operation. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  if (process.env.HCM_BP_MONITOR_ENABLED !== "true") {
    return bpMonitorJson({ error: "Not found." }, 404);
  }
  const user = await getSessionUser();
  if (!user) return bpMonitorJson({ error: "Authentication required." }, 401);

  const { instanceId: rawId } = await params;
  const instanceId = positiveBpMonitorId(rawId);
  const organizationId = positiveBpMonitorId(new URL(request.url).searchParams.get("organizationId"));
  if (!organizationId || !instanceId) {
    return bpMonitorJson({ error: "Valid organizationId and instanceId required." }, 400);
  }
  const denied = await denyBpMonitor(user.id, organizationId);
  if (denied) return denied;

  try {
    const result = await loadBpMonitorDetail(organizationId, instanceId);
    if (!result) return bpMonitorJson({ error: "Workflow not found in this employer." }, 404);
    return bpMonitorJson(result);
  } catch {
    return bpMonitorJson({ error: "Workflow steps temporarily unavailable." }, 503);
  }
}
