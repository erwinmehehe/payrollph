import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertMembership, assertScope, getAccess } from "@/lib/access";
import { resolveMultiEntityContext, assertEntityResource } from "@/lib/multi-entity-server";
import { listPayoutDestinationChangeRequests } from "@/lib/payout-destination-controls";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const employeeIdRaw = url.searchParams.get("employeeId");
  const employeeId = employeeIdRaw == null ? null : Number(employeeIdRaw);

  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }
  if (employeeId !== null && (!Number.isSafeInteger(employeeId) || employeeId <= 0)) {
    return Response.json({ error: "employeeId must be valid." }, { status: 400 });
  }

  const denied = await assertMembership(user.id, organizationId);
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  const entity = await resolveMultiEntityContext({ userId: user.id, organizationId, request });
  if (!entity.ok) return entity.response;
  const legalEntityId = entity.context.enabled ? entity.context.legalEntityId : undefined;
  // Company-wide membership is not a grant to every legal employer.
  if (legalEntityId === null) {
    return Response.json({ error: "Select an authorized legal employer." }, { status: 403 });
  }

  if (employeeId) {
    const [employee] = await db.select({
      id: employees.id,
      orgUnitId: employees.orgUnitId,
      legalEntityId: employees.legalEntityId,
    }).from(employees).where(and(
      eq(employees.id, employeeId),
      eq(employees.organizationId, organizationId),
    )).limit(1);
    if (!employee) return Response.json({ error: "Employee not found in this organization." }, { status: 404 });
    if (entity.context.enabled) {
      const entityDenied = assertEntityResource(entity.context, employee.legalEntityId);
      if (entityDenied) return entityDenied;
    }
    const scope = assertScope(access, employee.orgUnitId);
    if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });
  } else if (!access.companyWide) {
    return Response.json({ error: "Company-wide access is required to list all payout destination changes." }, { status: 403 });
  }

  const requests = await listPayoutDestinationChangeRequests({ organizationId, employeeId, legalEntityId });
  return Response.json({ requests }, { headers: { "Cache-Control": "private, no-store" } });
}
