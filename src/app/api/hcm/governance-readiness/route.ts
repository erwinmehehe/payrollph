import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { loadHcmGovernanceReadiness } from "@/lib/hcm-governance-readiness-server";

export const dynamic = "force-dynamic";

/** This endpoint only reads aggregate tenant evidence. */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "Valid organizationId is required." }, { status: 400 });
  }
  const denied = await assertOrganizationRole(
    user.id, organizationId, PEOPLE_ADMIN_ROLES,
    "Only authorized People administrators may review HCM governance exceptions.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({
      error: "HCM governance inspection requires company-wide People administration.",
    }, { status: 403 });
  }
  // The default-OFF release gate protects auto-deploying production main:
  // building/merging this read-only feature alone does not query live HCM.
  if (process.env.HCM_GOVERNANCE_READINESS_ENABLED !== "true") {
    return Response.json({
      code: "HCM_GOVERNANCE_READINESS_DISABLED",
      error: "The governance dashboard is not enabled in this environment.",
    }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  }
  return Response.json(await loadHcmGovernanceReadiness(organizationId), {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
