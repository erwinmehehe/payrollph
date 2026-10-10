import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { loadHcmPeopleHomeSources } from "@/lib/hcm-people-home-server";

export const dynamic = "force-dynamic";

/** Feature-gated, read-only projection; all mutations stay with owning modules. */
export async function GET(request: Request) {
  if (process.env.NEXT_PUBLIC_HCM_PEOPLE_HOME_ENABLED !== "true") {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "Valid organizationId required." }, { status: 400 });
  }

  // Both company-wide HR and the deny-only custom permission/session policy.
  const denied = await assertOrganizationRole(
    user.id, organizationId, PEOPLE_ADMIN_ROLES,
    "Company-wide People administration is required.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide || !["owner", "admin", "hr"].includes(access.role)) {
    return Response.json({ error: "Company-wide HR access required." }, { status: 403 });
  }

  const sources = await loadHcmPeopleHomeSources(organizationId, {
    userId: user.id,
    name: user.name,
    role: access.role,
  });
  return Response.json(
    { tenantId: organizationId, sources },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
