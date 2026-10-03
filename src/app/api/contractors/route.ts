import { enforceSameOriginMutation } from "@/lib/security-request";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { contractors } from "@/db/schema";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { encryptGovernmentId, maskGovernmentId } from "@/lib/government-id-crypto";

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
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Contractor records require company-wide People access." }, { status: 403 });
  }

  const rows = await db.select().from(contractors)
    .where(eq(contractors.organizationId, organizationId))
    .orderBy(contractors.createdAt);
  return Response.json(rows.map((row) => ({
    ...row,
    tin: maskGovernmentId(row.tin),
  })));
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
  const withholdingAtc = body.withholdingAtc ? String(body.withholdingAtc).trim().toUpperCase().slice(0, 24) : null;
  const withholdingRate =
    body.withholdingRate === undefined || body.withholdingRate === null || body.withholdingRate === ""
      ? null
      : Number(body.withholdingRate);
  if (withholdingRate !== null && (!Number.isFinite(withholdingRate) || withholdingRate < 0 || withholdingRate > 100)) {
    return Response.json({ error: "Contractor EWT rate must be between 0 and 100 percent." }, { status: 422 });
  }
  if ((withholdingRate ?? 0) > 0 && !withholdingAtc) {
    return Response.json({ error: "An explicit BIR ATC is required when contractor EWT is enabled." }, { status: 422 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can create contractors.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Contractor records require company-wide People access." }, { status: 403 });
  }

  const [row] = await db.insert(contractors).values({
    organizationId,
    name: String(body.name).slice(0, 200),
    email: String(body.email).trim().toLowerCase().slice(0, 200),
    country: body.country ? String(body.country).slice(0, 3) : "PH",
    currency: body.currency ? String(body.currency).slice(0, 3) : "USD",
    rate: Number(body.rate).toFixed(2),
    rateType: body.rateType ? String(body.rateType).slice(0, 20) : "monthly",
    tin: encryptGovernmentId(
      body.tin ? String(body.tin).trim() : null,
      { required: process.env.NODE_ENV === "production" },
    ),
    withholdingAtc,
    withholdingRate: withholdingRate === null ? null : withholdingRate.toFixed(3),
    contractStart: body.contractStart ? String(body.contractStart) : null,
    contractEnd: body.contractEnd ? String(body.contractEnd) : null,
    status: "active",
  }).returning();

  return Response.json({ ...row, tin: maskGovernmentId(row.tin) }, { status: 201 });
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
  const access = await getAccess(user.id, target.organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Contractor records require company-wide People access." }, { status: 403 });
  }

  let nextWithholdingRate: string | null | undefined;
  if (body.withholdingRate !== undefined) {
    if (body.withholdingRate === null || body.withholdingRate === "") {
      nextWithholdingRate = null;
    } else {
      const rate = Number(body.withholdingRate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
        return Response.json({ error: "Contractor EWT rate must be between 0 and 100 percent." }, { status: 422 });
      }
      nextWithholdingRate = rate.toFixed(3);
    }
  }

  const updates: Partial<typeof contractors.$inferInsert> = {};
  if (body.name !== undefined) updates.name = String(body.name).slice(0, 200);
  if (body.email !== undefined) updates.email = String(body.email).trim().toLowerCase().slice(0, 200);
  if (body.country !== undefined) updates.country = String(body.country).slice(0, 3);
  if (body.currency !== undefined) updates.currency = String(body.currency).slice(0, 3);
  if (body.rate !== undefined && Number.isFinite(Number(body.rate))) updates.rate = Number(body.rate).toFixed(2);
  if (body.rateType !== undefined) updates.rateType = String(body.rateType).slice(0, 20);
  if (body.tin !== undefined) {
    updates.tin = encryptGovernmentId(
      body.tin ? String(body.tin).trim() : null,
      { required: process.env.NODE_ENV === "production" },
    );
  }
  if (body.withholdingAtc !== undefined) {
    updates.withholdingAtc = body.withholdingAtc
      ? String(body.withholdingAtc).trim().toUpperCase().slice(0, 24)
      : null;
  }
  if (nextWithholdingRate !== undefined) updates.withholdingRate = nextWithholdingRate;
  const resultingAtc = updates.withholdingAtc === undefined ? target.withholdingAtc : updates.withholdingAtc;
  const resultingRate = updates.withholdingRate === undefined ? target.withholdingRate : updates.withholdingRate;
  if (Number(resultingRate ?? 0) > 0 && !resultingAtc) {
    return Response.json({ error: "An explicit BIR ATC is required when contractor EWT is enabled." }, { status: 422 });
  }
  if (body.status !== undefined) updates.status = String(body.status).slice(0, 32);
  if (body.contractStart !== undefined) updates.contractStart = body.contractStart ? String(body.contractStart) : null;
  if (body.contractEnd !== undefined) updates.contractEnd = body.contractEnd ? String(body.contractEnd) : null;

  const [row] = await db.update(contractors).set(updates).where(eq(contractors.id, id)).returning();
  return Response.json({ ...row, tin: maskGovernmentId(row.tin) });
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
  const access = await getAccess(user.id, target.organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Contractor records require company-wide People access." }, { status: 403 });
  }

  await db.delete(contractors).where(eq(contractors.id, id));
  return Response.json({ success: true });
}
