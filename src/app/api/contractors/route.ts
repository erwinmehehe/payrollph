import { enforceSameOriginMutation } from "@/lib/security-request";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { contractors } from "@/db/schema";
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
    "Only People administrators can view contractors.",
  );
  if (denied) return denied;

  const rows = await db.select().from(contractors)
    .where(eq(contractors.organizationId, organizationId))
    .orderBy(contractors.createdAt);
  return Response.json(rows);
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  if (!Number.isInteger(organizationId) || !body.name || !body.email || !Number.isFinite(Number(body.rate))) {
    return Response.json({ error: "organizationId, name, email and rate are required." }, { status: 400 });
  }
  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can create contractors.",
  );
  if (denied) return denied;

  const [row] = await db.insert(contractors).values({
    organizationId,
    name: String(body.name).slice(0, 200),
    email: String(body.email).trim().toLowerCase().slice(0, 200),
    country: body.country ? String(body.country).slice(0, 3) : "PH",
    currency: body.currency ? String(body.currency).slice(0, 3) : "USD",
    rate: Number(body.rate).toFixed(2),
    rateType: body.rateType ? String(body.rateType).slice(0, 20) : "monthly",
    contractStart: body.contractStart ? String(body.contractStart) : null,
    contractEnd: body.contractEnd ? String(body.contractEnd) : null,
    status: "active",
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
  if (!Number.isInteger(id)) return Response.json({ error: "Contractor id is required." }, { status: 400 });

  const [target] = await db.select().from(contractors).where(eq(contractors.id, id)).limit(1);
  if (!target) return Response.json({ error: "Contractor not found." }, { status: 404 });

  const denied = await assertOrganizationRole(
    user.id,
    target.organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can update contractors.",
  );
  if (denied) return denied;

  const updates: Partial<typeof contractors.$inferInsert> = {};
  if (body.name !== undefined) updates.name = String(body.name).slice(0, 200);
  if (body.email !== undefined) updates.email = String(body.email).trim().toLowerCase().slice(0, 200);
  if (body.country !== undefined) updates.country = String(body.country).slice(0, 3);
  if (body.currency !== undefined) updates.currency = String(body.currency).slice(0, 3);
  if (body.rate !== undefined && Number.isFinite(Number(body.rate))) updates.rate = Number(body.rate).toFixed(2);
  if (body.rateType !== undefined) updates.rateType = String(body.rateType).slice(0, 20);
  if (body.status !== undefined) updates.status = String(body.status).slice(0, 32);
  if (body.contractStart !== undefined) updates.contractStart = body.contractStart ? String(body.contractStart) : null;
  if (body.contractEnd !== undefined) updates.contractEnd = body.contractEnd ? String(body.contractEnd) : null;

  const [row] = await db.update(contractors).set(updates).where(eq(contractors.id, id)).returning();
  return Response.json(row);
}

export async function DELETE(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id)) return Response.json({ error: "Contractor id is required." }, { status: 400 });

  const [target] = await db.select().from(contractors).where(eq(contractors.id, id)).limit(1);
  if (!target) return Response.json({ error: "Contractor not found." }, { status: 404 });

  const denied = await assertOrganizationRole(
    user.id,
    target.organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can delete contractors.",
  );
  if (denied) return denied;

  await db.delete(contractors).where(eq(contractors.id, id));
  return Response.json({ success: true });
}
