import { and, asc, eq, gte, lt } from "drizzle-orm";
import { db } from "@/db";
import { staffingRequirements, worksites } from "@/db/schema";
import { getAccess, WORKFORCE_MANAGER_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { phWorkDateAt } from "@/lib/workforce-manager-actions";
import { authorizedOutlookSite } from "@/lib/workforce-demand-outlook-scope";
import {
  forecastHistoricalStaffingRequirements,
  shiftOutlookDate,
  WFM_OUTLOOK_LOOKBACK_DAYS,
  WFM_OUTLOOK_MAX_ROWS,
} from "@/lib/workforce-demand-outlook";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId") ?? "");
  const worksiteId = Number(url.searchParams.get("worksiteId") ?? "");
  const horizon = url.searchParams.get("horizonDays") ?? "7";
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0
    || !Number.isSafeInteger(worksiteId) || worksiteId <= 0
    || (horizon !== "7" && horizon !== "14")) {
    return Response.json({ error: "Valid employer, worksite and seven- or fourteen-day horizon are required." }, { status: 400 });
  }

  const access = await getAccess(user.id, organizationId);
  if (!access || !WORKFORCE_MANAGER_ROLES.some(role => role === access.role)) {
    return Response.json({ error: "Workforce manager access is required." }, { status: 403 });
  }

  try {
    const [site] = await db.select({
      id: worksites.id,
      name: worksites.name,
      organizationId: worksites.organizationId,
      orgUnitId: worksites.orgUnitId,
      active: worksites.active,
    }).from(worksites).where(and(
      eq(worksites.organizationId, organizationId),
      eq(worksites.id, worksiteId),
    )).limit(1);
    if (!site || !authorizedOutlookSite(access, site)) {
      // Do not disclose existence of a worksite owned by another tenant/unit.
      return Response.json({ error: "Worksite is unavailable within your authorized scope." }, { status: 403 });
    }

    const today = phWorkDateAt();
    const lookbackStart = shiftOutlookDate(today, -WFM_OUTLOOK_LOOKBACK_DAYS);
    const historical = await db.select({
      worksiteId: staffingRequirements.worksiteId,
      workDate: staffingRequirements.workDate,
      shiftDefinitionId: staffingRequirements.shiftDefinitionId,
      jobProfileId: staffingRequirements.jobProfileId,
      requiredHeadcount: staffingRequirements.requiredHeadcount,
    }).from(staffingRequirements).where(and(
      eq(staffingRequirements.organizationId, organizationId),
      eq(staffingRequirements.worksiteId, site.id),
      gte(staffingRequirements.workDate, lookbackStart),
      lt(staffingRequirements.workDate, today),
    )).orderBy(asc(staffingRequirements.workDate), asc(staffingRequirements.id))
      .limit(WFM_OUTLOOK_MAX_ROWS + 1);

    const outlook = forecastHistoricalStaffingRequirements({
      today,
      horizonDays: horizon === "14" ? 14 : 7,
      worksiteId: site.id,
      rows: historical.map(row => ({ ...row, workDate: String(row.workDate) })),
    });

    return Response.json({
      outlook,
      scope: { worksiteId: site.id, worksiteName: site.name, organizationId },
      readOnly: true,
      sourceQuality: outlook.status === "source_review"
        ? "Oversized, inconsistent or invalid historical staffing requirements; review the source before forecasting."
        : outlook.status === "insufficient_history"
          ? "Insufficient recent same-weekday staffing history for defensible estimates. Missing days remain unknown."
          : "Historical staffing-plan consistency only. Actual external customer demand has not been measured.",
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "Historical staffing source could not be reviewed." }, { status: 422 });
  }
}
