import { getSessionUser } from "@/lib/auth";
import {
  loadScopedWorkforceForecast,
  redactWorkforceForecastCosts,
} from "@/lib/workforce-forecast-server";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function finiteNumber(value: string | null, fallback: number) {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function optionalPositiveInt(value: string | null) {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : Number.NaN;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const startDate = String(url.searchParams.get("startDate") ?? "");
  const endDate = String(url.searchParams.get("endDate") ?? "");
  const demandGrowthPercent = finiteNumber(url.searchParams.get("demandGrowthPercent"), 0);
  const vacancyFillPercent = finiteNumber(url.searchParams.get("vacancyFillPercent"), 100);
  const employerLoadPercent = finiteNumber(url.searchParams.get("employerLoadPercent"), 0);
  const orgUnitId = optionalPositiveInt(url.searchParams.get("orgUnitId"));
  const worksiteId = optionalPositiveInt(url.searchParams.get("worksiteId"));

  if (
    !Number.isInteger(organizationId)
    || !ISO_DATE.test(startDate)
    || !ISO_DATE.test(endDate)
    || !Number.isFinite(demandGrowthPercent)
    || !Number.isFinite(vacancyFillPercent)
    || !Number.isFinite(employerLoadPercent)
    || Number.isNaN(orgUnitId)
    || Number.isNaN(worksiteId)
  ) {
    return Response.json({
      error: "organizationId, startDate/endDate, valid scope, and numeric forecast assumptions are required.",
    }, { status: 400 });
  }

  try {
    const result = await loadScopedWorkforceForecast({
      userId: user.id,
      organizationId,
      startDate,
      endDate,
      demandGrowthPercent,
      vacancyFillPercent,
      employerLoadPercent,
      orgUnitId,
      worksiteId,
    });
    return Response.json({
      forecast: result.canViewCost
        ? result.forecast
        : redactWorkforceForecastCosts(result.forecast),
      costVisible: result.canViewCost,
      scope: result.scope,
      boundary: "Planning estimate. Existing-worker employer costs use PayrollPH statutory formulas plus active benefit and recurring compensation records at the forecast start date. Vacancy benefit costs remain unknown until assigned; additional load % is scenario-only.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workforce forecast could not be calculated.";
    const status = /access|required|outside your assigned/i.test(message) ? 403 : 422;
    return Response.json({ error: message }, { status });
  }
}
