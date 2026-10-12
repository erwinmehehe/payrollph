import { asc, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { providerEvents } from "@/db/schema";
import { authorizeExtendedV1Read, apiV1Page } from "@/lib/api-v1-extended";

export const dynamic = "force-dynamic";

/**
 * Tenant-scoped durable inbound provider event receipts (migration 0110).
 * The outbound signed webhook delivery feed remains at /api/v1/events.
 * No provider payload, secret or personal account is returned.
 */
export async function GET(request: Request) {
  const auth = await authorizeExtendedV1Read(request, "payroll:read");
  if (!auth.ok) return auth.response;
  const page = apiV1Page(new URL(request.url).searchParams);
  if (!page) return Response.json({ error: "Invalid limit or offset." }, { status: 400 });
  const scope = eq(providerEvents.organizationId, auth.auth.organizationId);
  const [rows, totals] = await Promise.all([
    db.select({
      id: providerEvents.id, provider: providerEvents.provider,
      eventType: providerEvents.eventType, payrollRunId: providerEvents.payrollRunId,
      createdAt: providerEvents.createdAt,
    }).from(providerEvents).where(scope).orderBy(asc(providerEvents.id))
      .limit(page.limit).offset(page.offset),
    db.select({ value: count() }).from(providerEvents).where(scope),
  ]);
  const total = totals[0]?.value ?? 0;
  return Response.json({
    object: "list", source: "provider_inbox",
    total, ...page, hasMore: page.offset + rows.length < total,
    data: rows,
  }, { headers: { "Cache-Control": "no-store" } });
}
