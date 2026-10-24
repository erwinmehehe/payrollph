import { and, count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees, legalEntities, payrollRuns } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { canReadGroupReport, resolveMultiEntityContext } from "@/lib/multi-entity-server";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { groupReportHasUnattributedRows, sumPayrollAmounts } from "@/lib/multi-entity-money";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!criticalReleaseFlagEnabled("multiEntity"))
    return Response.json({ error: "Group reports unavailable." }, { status: 404 });
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0)
    return Response.json({ error: "Invalid tenant." }, { status: 400 });
  const allowed = await resolveMultiEntityContext({ userId: user.id, organizationId });
  if (!allowed.ok) return allowed.response;
  if (!canReadGroupReport(allowed.context))
    return Response.json({ error: "Only group roles can see group totals." }, { status: 403 });
  const [entities, headcounts, payrollCosts] = await Promise.all([
    db.select({ id: legalEntities.id, displayName: legalEntities.displayName, code: legalEntities.code })
      .from(legalEntities).where(and(
        // Keep inactive historical employers in all-entity payroll reports.
        // Deactivation must not erase prior released salary liability.
        eq(legalEntities.organizationId, organizationId),
        allowed.context.legalEntityId === null ? undefined
          : eq(legalEntities.id, allowed.context.legalEntityId),
      )),
    db.select({ legalEntityId: employees.legalEntityId, total: count() })
      .from(employees).where(and(
        eq(employees.organizationId, organizationId), eq(employees.status, "Active"),
        allowed.context.legalEntityId === null ? undefined
          : eq(employees.legalEntityId, allowed.context.legalEntityId),
      )).groupBy(employees.legalEntityId),
    db.select({
      legalEntityId: payrollRuns.legalEntityId,
      gross: sql<string>`coalesce(sum(${payrollRuns.grossPay}),0)::text`,
      net: sql<string>`coalesce(sum(${payrollRuns.netPay}),0)::text`,
      runs: count(),
    }).from(payrollRuns).where(and(
      eq(payrollRuns.organizationId, organizationId), eq(payrollRuns.status, "Released"),
      allowed.context.legalEntityId === null ? undefined
        : eq(payrollRuns.legalEntityId, allowed.context.legalEntityId),
    )).groupBy(payrollRuns.legalEntityId),
  ]);
  const results = entities.map(entity => {
    const h = headcounts.find(row => row.legalEntityId === entity.id);
    const p = payrollCosts.find(row => row.legalEntityId === entity.id);
    return {
      ...entity, headcount: h?.total ?? 0,
      gross: p?.gross ?? "0.00", net: p?.net ?? "0.00", releasedRuns: p?.runs ?? 0,
    };
  });
  // Unattributed payroll MUST NOT be silently grouped under PRIMARY.
  const unassigned = groupReportHasUnattributedRows(
    entities.map(entity => entity.id), headcounts, payrollCosts,
  );
  if (unassigned) return Response.json({
    error: "Unattributed legacy records must be reconciled before group totals are shown.",
    code: "ENTITY_ATTRIBUTION_REQUIRED",
  }, { status: 409 });
  return Response.json({
    entities: results,
    totals: {
      headcount: results.reduce((sum, row) => sum + row.headcount, 0),
      gross: sumPayrollAmounts(results.map(row => row.gross)),
      net: sumPayrollAmounts(results.map(row => row.net)),
    },
    period: "All released payroll history",
    selectedLegalEntityId: allowed.context.legalEntityId,
  }, { headers: { "Cache-Control": "no-store, private" } });
}
