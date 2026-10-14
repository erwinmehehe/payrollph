import { assertOrganizationRole, getAccess, PEOPLE_PAYROLL_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { resolveMultiEntityContext } from "@/lib/multi-entity-server";
import { multiEntityHcmDeferred } from "@/lib/multi-entity-hcm-hold";
import { loadEmploymentLifecycleReadiness } from "@/lib/hcm-lifecycle-readiness-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (multiEntityHcmDeferred()) {
    return Response.json({
      error: "HCM APIs are unavailable until multi-entity employer isolation is reviewed.",
      code: "ENTITY_HCM_DEFERRED",
    }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
  }
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "A valid organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Your role is not allowed to view employment lifecycle readiness.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({
      error: "Employment lifecycle readiness requires company-wide People or payroll access.",
    }, { status: 403 });
  }

  const entityAccess = await resolveMultiEntityContext({ userId: user.id, organizationId, request });
  if (!entityAccess.ok) return entityAccess.response;
  const legalEntityId = entityAccess.context.enabled ? entityAccess.context.legalEntityId : null;
  if (entityAccess.context.enabled && legalEntityId === null) {
    return Response.json({ error: "Select one legal employer to review employment readiness." }, { status: 403 });
  }
  const payload = await loadEmploymentLifecycleReadiness(organizationId, undefined, legalEntityId);
  return Response.json({ ...payload, organizationId, legalEntityId },
    { headers: { "Cache-Control": "private, no-store" } });
}
