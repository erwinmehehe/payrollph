import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assets } from "@/db/schema";
import { assertOrganizationRole, PEOPLE_ADMIN_ROLES } from "@/lib/access";
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

  const rows = await db.select().from(assets)
    .where(eq(assets.organizationId, organizationId))
    .orderBy(assets.createdAt);
  return Response.json(rows);
}

export async function POST(request: Request) {
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

  const [row] = await db.insert(assets).values({
    organizationId,
    type: String(body.type).slice(0, 50),
    name: String(body.name).slice(0, 200),
    serialNumber: body.serialNumber ? String(body.serialNumber).slice(0, 100) : null,
    employeeId: Number.isInteger(Number(body.employeeId)) ? Number(body.employeeId) : null,
    status: body.status ? String(body.status).slice(0, 32) : "assigned",
    assignedOn: body.assignedOn ? String(body.assignedOn) : null,
  }).returning();

  return Response.json(row, { status: 201 });
}

export async function PATCH(request: Request) {
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

  const updates: Partial<typeof assets.$inferInsert> = {};
  if (body.type !== undefined) updates.type = String(body.type).slice(0, 50);
  if (body.name !== undefined) updates.name = String(body.name).slice(0, 200);
  if (body.serialNumber !== undefined) updates.serialNumber = body.serialNumber ? String(body.serialNumber).slice(0, 100) : null;
  if (body.employeeId !== undefined) updates.employeeId = body.employeeId == null ? null : Number(body.employeeId);
  if (body.status !== undefined) updates.status = String(body.status).slice(0, 32);
  if (body.assignedOn !== undefined) updates.assignedOn = body.assignedOn ? String(body.assignedOn) : null;
  if (body.returnedOn !== undefined) updates.returnedOn = body.returnedOn ? String(body.returnedOn) : null;

  const [row] = await db.update(assets).set(updates).where(eq(assets.id, id)).returning();
  return Response.json(row);
}

export async function DELETE(request: Request) {
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

  await db.delete(assets).where(eq(assets.id, id));
  return Response.json({ success: true });
}
