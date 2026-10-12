import { getSessionUser } from "./auth";
import { assertMembership, getAccess } from "./access";
import { criticalReleaseFlagEnabled } from "./critical-release-flags";
export async function journeyAccess(organizationId: number, readOnly = false) {
  if (!criticalReleaseFlagEnabled("inlineFirstPayroll")) return Response.json({ error: "Inline first payroll is disabled." }, { status: 404 });
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) return Response.json({ error: "Valid organizationId required." }, { status: 400 });
  const user = await getSessionUser({ readOnly });
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const denied = await assertMembership(user.id, organizationId);
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide || !["owner", "admin", "hr", "payroll", "checker", "bookkeeper"].includes(access.role)) return Response.json({ error: "Company-wide journey access required." }, { status: 403 });
  return { user, access };
}

