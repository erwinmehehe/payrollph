import { parseDashboardSnapshotRead } from "@/lib/dashboard-snapshot-read";
import { getDashboardData } from "@/lib/dashboard-data";
import { deriveMyTeamScope } from "@/lib/hcm-my-team-contract";
import { assertMembership, getAccess } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const organizationId = Number(searchParams.get("organizationId"));
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const deniedOrg = await assertMembership(user.id, organizationId);
  if (deniedOrg) return deniedOrg;
  const access = await getAccess(user.id, organizationId);
  if (!access || access.role === "employee") {
    return Response.json({ error: "Employee self-service memberships cannot access the company dashboard." }, { status: 403 });
  }
  // An unassigned manager must get a controlled denial, not company-wide
  // data or an uncaught dashboard loader exception.
  if (access.role === "manager" && deriveMyTeamScope(access)?.kind !== "unit") {
    return Response.json({ error: "Assign a supervisory unit before opening the manager dashboard." }, { status: 403 });
  }
  let data;
  try {
    data = parseDashboardSnapshotRead(true, await getDashboardData(organizationId, request), organizationId);
  } catch {
    data = null;
  }
  if (!data) return Response.json({ error: "Workspace unavailable. Retry." }, {
    status: 503, headers: { "Cache-Control": "private, no-store" },
  });
  return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
}
