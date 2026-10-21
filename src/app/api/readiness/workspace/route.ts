import { tenantReadinessUnavailable } from "@/lib/workspace-readiness-boundary";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess, ORG_ADMIN_ROLES } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "organizationId is required." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    ORG_ADMIN_ROLES,
    "Only company-wide administrators and bookkeepers can view rollout readiness.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Rollout readiness requires company-wide access." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  // Tenant-selected authorization does not grant access to platform-wide
  // operational evidence. Refuse a success state until an isolated,
  // employer-verified readiness loader exists for this workspace.
  return tenantReadinessUnavailable(organizationId);
}
