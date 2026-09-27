import { eq } from "drizzle-orm";
import { db } from "@/db";
import { contractors } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const organizationId = parseInt(url.searchParams.get("organizationId") || "1");

  const rows = await db
    .select()
    .from(contractors)
    .where(eq(contractors.organizationId, organizationId))
    .orderBy(contractors.createdAt);

  return Response.json(rows);
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { organizationId, name, email, country, currency, rate, rateType, contractStart, contractEnd } = body;

  if (!organizationId || !name || !email || !rate) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  const [row] = await db
    .insert(contractors)
    .values({
      organizationId,
      name,
      email,
      country: country || "PH",
      currency: currency || "USD",
      rate: rate.toString(),
      rateType: rateType || "monthly",
      contractStart,
      contractEnd,
      status: "active",
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

  if (!id) {
    return Response.json({ error: "Missing contractor ID" }, { status: 400 });
  }

  const [row] = await db
    .update(contractors)
    .set(updates)
    .where(eq(contractors.id, id))
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

  if (!id) {
    return Response.json({ error: "Missing contractor ID" }, { status: 400 });
  }

  await db.delete(contractors).where(eq(contractors.id, id));

  return Response.json({ success: true });
}
