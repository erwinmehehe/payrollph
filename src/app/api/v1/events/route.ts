import { and, asc, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { providerEvents } from "@/db/schema";
import { authorizeExtendedApi, pagination } from "@/lib/public-api-v1-extended";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await authorizeExtendedApi(request, "events:read");
  if (!auth.ok) return auth.response;
  const page = pagination(new URL(request.url), 100);
  if (!page) return Response.json({ error: "Invalid limit or after cursor." }, { status: 400 });
  const rows = await db.select({
    cursor: providerEvents.id, eventId: providerEvents.eventId,
    eventType: providerEvents.eventType, createdAt: providerEvents.createdAt,
  }).from(providerEvents).where(and(
    eq(providerEvents.organizationId, auth.organizationId),
    eq(providerEvents.provider, "linaw"),
    gt(providerEvents.id, page.after),
  )).orderBy(asc(providerEvents.id)).limit(page.limit + 1);
  const selected = rows.slice(0, page.limit);
  return Response.json({
    object: "event_list", data: selected, hasMore: rows.length > page.limit,
    nextCursor: rows.length > page.limit ? selected[selected.length - 1]?.cursor ?? null : null,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
