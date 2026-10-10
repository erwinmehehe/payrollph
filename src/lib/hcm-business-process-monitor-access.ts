import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";

/** Existing role gate enforces active membership, organization session policy,
 * and deny-only custom People-admin permission. Restrict further to company-wide
 * owner/admin/HR; bookkeeper is not part of this monitor's authority. */
export async function denyBpMonitor(userId: number, organizationId: number): Promise<Response | null> {
  const denied = await assertOrganizationRole(
    userId, organizationId, PEOPLE_ADMIN_ROLES, "Company-wide People administration required.",
  );
  if (denied) return denied;
  const access = await getAccess(userId, organizationId);
  if (!access?.companyWide || !["owner", "admin", "hr"].includes(access.role)) {
    return Response.json({ error: "Company-wide HR access required." }, {
      status: 403, headers: { "Cache-Control": "private, no-store" },
    });
  }
  return null;
}

export function positiveBpMonitorId(value: string | null): number | null {
  if (value === null || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function bpMonitorJson(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}
