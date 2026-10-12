import { and, asc, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { orgUnits } from "@/db/schema";
import { authorizeExtendedApi, pagination } from "@/lib/public-api-v1-extended";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await authorizeExtendedApi(request, "org-units:read");
  if (!auth.ok) return auth.response;
  const page = pagination(new URL(request.url));
  if (!page) return Response.json({ error: "limit (1-100) and after (nonnegative integer) required." }, { status: 400 });
  const rows = await db.select({
    id: orgUnits.id, code: orgUnits.code, name: orgUnits.name,
    type: orgUnits.type, parentId: orgUnits.parentId, active: orgUnits.active,
  }).from(orgUnits).where(and(
    eq(orgUnits.organizationId, auth.organizationId),
    eq(orgUnits.legalEntityId, auth.legalEntityId),
    gt(orgUnits.id, page.after),
  )).orderBy(asc(orgUnits.id)).limit(page.limit + 1);
  const selected = rows.slice(0, page.limit);
  return Response.json({
    object: "list", data: selected, hasMore: rows.length > page.limit,
    nextCursor: rows.length > page.limit ? selected[selected.length - 1]?.id ?? null : null,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
