import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assets } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertPermission } from "@/lib/access";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const organizationId = parseInt(url.searchParams.get("organizationId") || "1");

  const denied = await assertPermission(user.id, organizationId, "assets:read");
  if (denied) return denied;

  const rows = await db
    .select()
    .from(assets)
    .where(eq(assets.organizationId, organizationId))
    .orderBy(assets.createdAt);

  return Response.json(rows);
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { organizationId, type, name, serialNumber, employeeId, status, assignedOn } = body;

  if (!organizationId || !type || !name) return Response.json({ error: "Missing required fields" }, { status: 400 });
  const denied = await assertPermission(user.id, Number(organizationId), "assets:write");
  if (denied) return denied;

  const [row] = await db
    .insert(assets)
    .values({
      organizationId,
      type,
      name,
      serialNumber,
      employeeId,
      status: status || "assigned",
      assignedOn,
    })
    .returning();

  return Response.json(row, { status: 201 });
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { id, ...updates } = body;

  if (!id) return Response.json({ error: "Missing asset ID" }, { status: 400 });
  const [existing] = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  if (!existing) return Response.json({ error: "Asset not found" }, { status: 404 });
  const denied = await assertPermission(user.id, existing.organizationId, "assets:write");
  if (denied) return denied;
  delete updates.organizationId;
  const [row] = await db.update(assets)
    .set(updates)
    .where(eq(assets.id, id))
    .returning();

  return Response.json(row);
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get("id") || "0");

  if (!id) return Response.json({ error: "Missing asset ID" }, { status: 400 });
  const [existing] = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  if (!existing) return Response.json({ error: "Asset not found" }, { status: 404 });
  const denied = await assertPermission(user.id, existing.organizationId, "assets:write");
  if (denied) return denied;
  await db.delete(assets).where(eq(assets.id, id));

  return Response.json({ success: true });
}
