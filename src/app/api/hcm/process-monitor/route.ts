import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import {
  canonicalHcmId, canReadHcmProcessMonitor,
  monitorEnabledForEmployer, validMonitorFilter,
} from "@/lib/hcm-process-monitor";
import { loadHcmProcessMonitor } from "@/lib/hcm-process-monitor-server";

export const dynamic = "force-dynamic";

function respond(payload: unknown, status = 200) {
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

/** No mutation method. Business-process decisions remain in the governed inbox. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const organizationId = canonicalHcmId(params.get("organizationId"));
  if (!organizationId || !monitorEnabledForEmployer(organizationId)) {
    return respond({ error: "Not found." }, 404);
  }
  const user = await getSessionUser();
  if (!user) return respond({ error: "Authentication required." }, 401);

  const cursor = params.has("cursor") ? canonicalHcmId(params.get("cursor"), true) : 0;
  const selectedProcessId = params.has("processId")
    ? canonicalHcmId(params.get("processId")) : null;
  const filter = params.get("status") ?? "all";
  if (cursor === null || (params.has("processId") && selectedProcessId === null) ||
      !validMonitorFilter(filter)) {
    return respond({ error: "Invalid process filter or cursor." }, 400);
  }

  const denied = await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES);
  const access = denied ? null : await getAccess(user.id, organizationId);
  if (denied || !canReadHcmProcessMonitor(access)) {
    // No permission-set name, cross-tenant resource count or HR actor details.
    return respond({ error: "Company-wide People monitoring access required." }, denied?.status ?? 403);
  }

  try {
    return respond(await loadHcmProcessMonitor({
      organizationId, filter, cursor, selectedProcessId,
    }));
  } catch {
    return respond({ error: "Process monitoring source temporarily unavailable." }, 503);
  }
}
