import { and, asc, eq, count } from "drizzle-orm";
import { db } from "@/db";
import { webhookDeliveries } from "@/db/schema";
import { authorizeExtendedV1Read, apiV1Page } from "@/lib/api-v1-extended";

export const dynamic = "force-dynamic";

/** Tenant-scoped webhook delivery receipts; secret and event payload stay private. */
export async function GET(request: Request) {
  const gate = await authorizeExtendedV1Read(request, "payroll:read");
  if (!gate.ok) return gate.response;
  const page = apiV1Page(new URL(request.url).searchParams);
  if (!page) return Response.json({ error: "Invalid limit or offset." }, { status: 400 });
  const predicate = eq(webhookDeliveries.organizationId, gate.auth.organizationId);
  const [rows, totals] = await Promise.all([
    db.select({
      id: webhookDeliveries.id, event: webhookDeliveries.event,
      status: webhookDeliveries.status, attempts: webhookDeliveries.attempts,
      createdAt: webhookDeliveries.createdAt, deliveredAt: webhookDeliveries.deliveredAt,
    }).from(webhookDeliveries).where(predicate)
      .orderBy(asc(webhookDeliveries.id)).limit(page.limit).offset(page.offset),
    db.select({ value: count() }).from(webhookDeliveries).where(predicate),
  ]);
  const total = totals[0]?.value ?? 0;
  return Response.json({ object: "list", ...page, total,
    hasMore: page.offset + rows.length < total, data: rows,
  }, { headers: { "Cache-Control": "no-store" } });
}
