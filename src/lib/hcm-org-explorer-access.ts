import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";

/** Null means authorized. Existing role gate enforces active membership,
 * session policy, and the custom deny-only people.admin permission. */
export async function denyHcmOrgExplorer(userId: number, organizationId: number): Promise<Response | null> {
  const denied = await assertOrganizationRole(
    userId, organizationId, PEOPLE_ADMIN_ROLES,
    "Company-wide People administration is required.",
  );
  if (denied) return denied;
  const access = await getAccess(userId, organizationId);
  // PEOPLE_ADMIN_ROLES also includes bookkeepers; this projection does not.
  if (!access?.companyWide || !["owner", "admin", "hr"].includes(access.role)) {
    return Response.json({ error: "Company-wide HR access required." }, { status: 403 });
  }
  return null;
}

/** Reject fractional, negative, zero, blank and unsafe integer IDs. */
export function hcmOrgExplorerPositiveId(value: string | null): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function hcmOrgExplorerJson(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
