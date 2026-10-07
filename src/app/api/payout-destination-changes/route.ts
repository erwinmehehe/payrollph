import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertMembership, assertScope, getAccess } from "@/lib/access";
import { listPayoutDestinationChangeRequests } from "@/lib/payout-destination-controls";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const employeeIdRaw = url.searchParams.get("employeeId");
  const employeeId = employeeIdRaw ? Number(employeeIdRaw) : null;

  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }
  if (employeeIdRaw && !Number.isInteger(employeeId)) {
    return Response.json({ error: "employeeId must be valid." }, { status: 400 });
  }

  const denied = await assertMembership(user.id, organizationId);
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  if (employeeId) {
    const [employee] = await db.select({
      id: employees.id,
      orgUnitId: employees.orgUnitId,
    }).from(employees).where(and(
      eq(employees.id, employeeId),
      eq(employees.organizationId, organizationId),
    )).limit(1);
    if (!employee) return Response.json({ error: "Employee not found in this organization." }, { status: 404 });
    const scope = assertScope(access, employee.orgUnitId);
    if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });
  } else if (!access.companyWide) {
    return Response.json({ error: "Company-wide access is required to list all payout destination changes." }, { status: 403 });
  }

  const requests = await listPayoutDestinationChangeRequests({ organizationId, employeeId });
  return Response.json({ requests });
}
