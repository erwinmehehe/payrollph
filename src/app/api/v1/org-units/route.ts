import { asc, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { orgUnits } from "@/db/schema";
import { authorizeExtendedV1Read, apiV1Page } from "@/lib/api-v1-extended";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const gate = await authorizeExtendedV1Read(request, "employees:read");
  if (!gate.ok) return gate.response;
  const page = apiV1Page(new URL(request.url).searchParams);
  if (!page) return Response.json({ error: "Invalid limit or offset." }, { status: 400 });
  const conditions = eq(orgUnits.organizationId, gate.auth.organizationId);
  const [rows, totals] = await Promise.all([
    db.select({
      id: orgUnits.id, code: orgUnits.code, name: orgUnits.name,
      type: orgUnits.type, parentId: orgUnits.parentId,
      legalEntityId: orgUnits.legalEntityId, active: orgUnits.active,
    }).from(orgUnits).where(conditions)
      .orderBy(asc(orgUnits.id)).limit(page.limit).offset(page.offset),
    db.select({ value: count() }).from(orgUnits).where(conditions),
  ]);
  const total = totals[0]?.value ?? 0;
  return Response.json({ object: "list", total, ...page,
    hasMore: page.offset + rows.length < total, data: rows,
  }, { headers: { "Cache-Control": "no-store" } });
}
