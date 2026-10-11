import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { worksites } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { getAccess, WORKFORCE_MANAGER_ROLES } from "@/lib/access";
import { phWorkDateAt } from "@/lib/workforce-manager-actions";
import { receiptPilotAllowed, validReceiptId } from "@/lib/workforce-schedule-receipt";
import { DEMAND_METRICS, type DemandMetric, type DemandQuality } from "@/lib/workforce-operational-demand-import";
import { operationalDemandSiteAuthorized } from "@/lib/workforce-operational-demand-scope";
import { loadOperationalDemandVersions } from "@/lib/workforce-operational-demand-server";
import { forecastObservedWorkload, WORKLOAD_MAX_VERSIONS } from "@/lib/workforce-operational-demand-forecast";

export const dynamic = "force-dynamic";

/** Read source-reported, aggregate volume only. No worker/timeclock/wage joins. */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const organizationId = Number(params.get("organizationId") ?? "");
  const worksiteId = Number(params.get("worksiteId") ?? "");
  const sourceKey = params.get("sourceKey") ?? "";
  const metricKind = params.get("metricKind") ?? "";
  const intervalMinutes = Number(params.get("intervalMinutes") ?? "");
  const horizonDays = Number(params.get("horizonDays") ?? "7");
  if (!validReceiptId(organizationId) || !validReceiptId(worksiteId)
    || !/^[a-z][a-z0-9._-]{2,63}$/.test(sourceKey)
    || !DEMAND_METRICS.includes(metricKind as DemandMetric)
    || ![15, 30, 60].includes(intervalMinutes)
    || ![7, 14].includes(horizonDays)) {
    return Response.json({ error: "Valid scoped demand source and seven-/fourteen-day horizon required." }, { status: 400 });
  }
  if (!receiptPilotAllowed(
    organizationId, process.env.WFM_OPERATIONAL_DEMAND_ENABLED,
    process.env.WFM_OPERATIONAL_DEMAND_ALLOWED_ORGANIZATION_IDS,
  )) {
    return Response.json({ error: "Operational workload forecasting is not enabled for this employer." }, { status: 404 });
  }
  const access = await getAccess(user.id, organizationId);
  if (!access || !WORKFORCE_MANAGER_ROLES.some(role => role === access.role)) {
    return Response.json({ error: "Workforce manager access is required." }, { status: 403 });
  }
  try {
    const [site] = await db.select({
      id: worksites.id, organizationId: worksites.organizationId,
      orgUnitId: worksites.orgUnitId, active: worksites.active, timezone: worksites.timezone,
    }).from(worksites).where(and(
      eq(worksites.organizationId, organizationId), eq(worksites.id, worksiteId),
    )).limit(1);
    if (!site || !operationalDemandSiteAuthorized(access, site)) {
      return Response.json({ error: "Worksite unavailable within your manager scope." }, { status: 403 });
    }
    if (site.timezone !== "Asia/Manila") {
      return Response.json({ error: "Only Philippine worksite timezone is supported by this pilot." }, { status: 409 });
    }
    const today = phWorkDateAt();
    const midnight = Date.parse(today + "T00:00:00Z") - 8 * 3600_000;
    const observations = await loadOperationalDemandVersions({
      organizationId, worksiteId, sourceKey, metricKind, intervalMinutes,
      from: new Date(midnight - 183 * 86_400_000), to: new Date(midnight),
      limit: WORKLOAD_MAX_VERSIONS + 1,
    });
    const forecast = forecastObservedWorkload({
      metricKind: metricKind as DemandMetric,
      intervalMinutes: intervalMinutes as 15 | 30 | 60,
      horizonDays: horizonDays as 7 | 14, today,
      observations: observations.map(row => ({
        ...row, intervalStart: row.intervalStart.toISOString(),
        intervalMinutes: row.intervalMinutes as 15 | 30 | 60,
        quality: row.quality as DemandQuality,
      })),
    });
    return Response.json({
      forecast, readOnly: true,
      scope: { organizationId, worksiteId, sourceKey, metricKind, intervalMinutes },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "Workload source is unavailable or not yet migrated." }, { status: 503 });
  }
}
