import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { multiEntityHcmDeferred } from "@/lib/multi-entity-hcm-hold";
import { resolveMultiEntityContext } from "@/lib/multi-entity-server";

export async function effectiveCorrectionAccess(userId: number, organizationId: number) {
  if (multiEntityHcmDeferred()) return Response.json({ error: "HCM employer isolation is not enabled for this operation." }, { status: 403 });
  const denied = await assertOrganizationRole(userId, organizationId, PEOPLE_ADMIN_ROLES);
  if (denied) return denied;
  const access = await getAccess(userId, organizationId);
  if (!access?.companyWide) return Response.json({ error: "Company-wide People access required." }, { status: 403 });
  const scope = await resolveMultiEntityContext({ userId, organizationId });
  if (!scope.ok) return scope.response;
  if (scope.context.enabled && !scope.context.group) return Response.json({ error: "Group People access required." }, { status: 403 });
  return null;
}
