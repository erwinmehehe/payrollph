import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { HcmMonitorSourceCapError, loadMonitor } from "@/lib/hcm-bp-monitor-server";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "private, no-store" };

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: noStore });
}

function positiveId(value: string | null): number | null {
  if (!value || !/^[0-9]+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Read-only monitor. Decisions and delegation remain with owning endpoints. */
export async function GET(request: Request) {
  if (process.env.HCM_BP_MONITOR_ENABLED !== "true") {
    return json({ error: "Not found." }, 404);
  }
  const user = await getSessionUser();
  if (!user) return json({ error: "Authentication required." }, 401);

  const params = new URL(request.url).searchParams;
  const organizationId = positiveId(params.get("organizationId"));
  const rawCursor = params.get("beforeId");
  const cursor = rawCursor === null ? null : positiveId(rawCursor);
  if (!organizationId || (rawCursor !== null && cursor === null)) {
    return json({ error: "Valid organizationId and beforeId required." }, 400);
  }

  const denied = await assertOrganizationRole(
    user.id, organizationId, PEOPLE_ADMIN_ROLES,
    "Company-wide HR monitoring is required.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide || !["owner", "admin", "hr"].includes(access.role)) {
    return json({ error: "Company-wide HR monitoring is required." }, 403);
  }

  try {
    return json(await loadMonitor(organizationId, cursor));
  } catch (error) {
    if (error instanceof HcmMonitorSourceCapError) {
      return json({ error: "Too many workflow steps for the current bounded page. A complete monitor preview cannot be shown." }, 409);
    }
    return json({ error: "Business process monitor source unavailable." }, 503);
  }
}
