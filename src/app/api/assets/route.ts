import { enforceSameOriginMutation } from "@/lib/security-request";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, employees } from "@/db/schema";
import { assertOrganizationRole, assertScope, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }
  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can view company assets.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  const rows = await db.select().from(assets)
    .where(eq(assets.organizationId, organizationId))
    .orderBy(assets.createdAt);
  if (access.companyWide) return Response.json(rows);

  const staff = await db.select({ id: employees.id, orgUnitId: employees.orgUnitId })
    .from(employees)
    .where(eq(employees.organizationId, organizationId));
  const visibleIds = new Set(staff.filter((employee) => employee.orgUnitId === access.orgUnitId).map((employee) => employee.id));
  return Response.json(rows.filter((asset) => asset.employeeId != null && visibleIds.has(asset.employeeId)));
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  if (!Number.isInteger(organizationId) || !body.type || !body.name) {
    return Response.json({ error: "organizationId, type and name are required." }, { status: 400 });
  }
  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can create company assets.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  let employeeId: number | null = null;
  if (body.employeeId !== undefined && body.employeeId !== null && body.employeeId !== "") {
    const candidate = Number(body.employeeId);
    if (!Number.isInteger(candidate)) {
      return Response.json({ error: "employeeId must be an integer." }, { status: 422 });
    }
    const [employee] = await db.select({ id: employees.id, orgUnitId: employees.orgUnitId }).from(employees)
      .where(and(eq(employees.id, candidate), eq(employees.organizationId, organizationId)))
      .limit(1);
    if (!employee) {
      return Response.json({ error: "Employee not found in this organization." }, { status: 404 });
    }
    const scope = assertScope(access, employee.orgUnitId);
    if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });
    employeeId = employee.id;
  } else if (!access.companyWide) {
    return Response.json({ error: "Unit-scoped roles can create assets only when assigned to an employee in their own unit." }, { status: 403 });
  }

  const [row] = await db.insert(assets).values({
    organizationId,
    type: String(body.type).slice(0, 50),
    name: String(body.name).slice(0, 200),
    serialNumber: body.serialNumber ? String(body.serialNumber).slice(0, 100) : null,
    employeeId,
    status: body.status ? String(body.status).slice(0, 32) : "assigned",
    assignedOn: body.assignedOn ? String(body.assignedOn) : null,
  }).returning();

  return Response.json(row, { status: 201 });
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isInteger(id)) return Response.json({ error: "Asset id is required." }, { status: 400 });

  const [target] = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  if (!target) return Response.json({ error: "Asset not found." }, { status: 404 });

  const denied = await assertOrganizationRole(
    user.id,
    target.organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can update company assets.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, target.organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  if (!access.companyWide) {
    if (target.employeeId == null) return Response.json({ error: "Unit-scoped roles cannot modify unassigned company assets." }, { status: 403 });
    const [currentEmployee] = await db.select({ orgUnitId: employees.orgUnitId }).from(employees)
      .where(and(eq(employees.id, target.employeeId), eq(employees.organizationId, target.organizationId)))
      .limit(1);
    const currentScope = assertScope(access, currentEmployee?.orgUnitId ?? null);
    if (!currentEmployee || !currentScope.ok) return Response.json({ error: "Asset is outside your assigned unit." }, { status: 403 });
  }

  const updates: Partial<typeof assets.$inferInsert> = {};
  if (body.type !== undefined) updates.type = String(body.type).slice(0, 50);
  if (body.name !== undefined) updates.name = String(body.name).slice(0, 200);
  if (body.serialNumber !== undefined) updates.serialNumber = body.serialNumber ? String(body.serialNumber).slice(0, 100) : null;
  if (body.employeeId !== undefined) {
    if (body.employeeId === null || body.employeeId === "") {
      if (!access.companyWide) return Response.json({ error: "Unit-scoped roles cannot unassign company assets." }, { status: 403 });
      updates.employeeId = null;
    } else {
      const candidate = Number(body.employeeId);
      if (!Number.isInteger(candidate)) {
        return Response.json({ error: "employeeId must be an integer." }, { status: 422 });
      }
      const [employee] = await db.select({ id: employees.id, orgUnitId: employees.orgUnitId }).from(employees)
        .where(and(eq(employees.id, candidate), eq(employees.organizationId, target.organizationId)))
        .limit(1);
      if (!employee) {
        return Response.json({ error: "Employee not found in this organization." }, { status: 404 });
      }
      const scope = assertScope(access, employee.orgUnitId);
      if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });
      updates.employeeId = employee.id;
    }
  }
  if (body.status !== undefined) updates.status = String(body.status).slice(0, 32);
  if (body.assignedOn !== undefined) updates.assignedOn = body.assignedOn ? String(body.assignedOn) : null;
  if (body.returnedOn !== undefined) updates.returnedOn = body.returnedOn ? String(body.returnedOn) : null;

  const [row] = await db.update(assets).set(updates).where(eq(assets.id, id)).returning();
  return Response.json(row);
}

export async function DELETE(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id)) return Response.json({ error: "Asset id is required." }, { status: 400 });

  const [target] = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  if (!target) return Response.json({ error: "Asset not found." }, { status: 404 });

  const denied = await assertOrganizationRole(
    user.id,
    target.organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can delete company assets.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, target.organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  if (!access.companyWide) {
    if (target.employeeId == null) return Response.json({ error: "Unit-scoped roles cannot delete unassigned company assets." }, { status: 403 });
    const [employee] = await db.select({ orgUnitId: employees.orgUnitId }).from(employees)
      .where(and(eq(employees.id, target.employeeId), eq(employees.organizationId, target.organizationId)))
      .limit(1);
    const scope = assertScope(access, employee?.orgUnitId ?? null);
    if (!employee || !scope.ok) return Response.json({ error: "Asset is outside your assigned unit." }, { status: 403 });
  }

  await db.delete(assets).where(eq(assets.id, id));
  return Response.json({ success: true });
}
