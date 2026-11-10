import { buildTenantWorkspaceReadiness, tenantReadinessUnavailable } from "@/lib/workspace-readiness-boundary";
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
  if (denied) {
    denied.headers.set("Cache-Control", "no-store");
    return denied;
  }

  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Rollout readiness requires company-wide access." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  // Authentication and full-employer authorization always precede any data read.
  // Never call the platform-wide operational loader; it includes cross-employer data.
  try {
    return await buildTenantWorkspaceReadiness(organizationId);
  } catch {
    // Outage or missing schema is not launch readiness; never expose SQL errors.
    return tenantReadinessUnavailable(organizationId);
  }
}
