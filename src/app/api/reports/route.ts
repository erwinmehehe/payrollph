import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { REPORT_DEFINITIONS, reportToCsv, runReport, type ReportKey } from "@/lib/reports";
import { assertOrganizationRole, getAccess, PEOPLE_PAYROLL_ROLES } from "@/lib/access";
import { hcmAnalyticsDate } from "@/lib/hcm-people-intelligence";
import { philippinePeopleAnalyticsDate } from "@/lib/hcm-people-intelligence-server";

export const dynamic = "force-dynamic";

const VALID: ReportKey[] = ["headcount", "cost", "turnover", "compliance", "assurance", "workforce", "lifecycle", "people"];

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const organizationId = Number(searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }
  const deniedOrg = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Only People or payroll administrators can view company analytics.",
  );
  if (deniedOrg) return deniedOrg;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Company-wide analytics are not available to unit-scoped roles." }, { status: 403 });
  }
  const key = (searchParams.get("key") ?? "") as ReportKey;
  const format = searchParams.get("format") ?? "json";

  if (!key) {
    return Response.json({ definitions: REPORT_DEFINITIONS });
  }
  if (!VALID.includes(key)) {
    return Response.json({ error: "Unknown report key." }, { status: 400 });
  }
  if (format !== "json" && format !== "csv") {
    return Response.json({ error: "Report format must be json or csv." }, { status: 400 });
  }

  // Both rendered results and CSV export use the exact same validated
  // as-of date/window, so exports cannot silently change scope.
  let asOf: string | undefined;
  let windowDays: number | undefined;
  if (key === "people") {
    const requestedDate = searchParams.get("asOf");
    const today = philippinePeopleAnalyticsDate();
    try {
      asOf = hcmAnalyticsDate(requestedDate || today, today);
    } catch {
      return Response.json({ error: "asOf must be YYYY-MM-DD, no later than today in Asia/Manila." }, { status: 400 });
    }
    const rawWindow = searchParams.get("windowDays");
    windowDays = rawWindow == null ? 90 : Number(rawWindow);
    if (!Number.isInteger(windowDays) || ![30, 90, 180, 365].includes(windowDays)) {
      return Response.json({ error: "windowDays must be 30, 90, 180 or 365." }, { status: 400 });
    }
  }

  const report = await runReport(key, organizationId, { asOf, windowDays });

  if (format === "csv") {
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Report exported",
      resource: key,
      metadata: { format: "csv", rows: report.rows.length, ...(key === "people" ? { asOf, windowDays } : {}) },
    });
    return new Response(reportToCsv(report), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename=linaw-${key}-report.csv`,
      },
    });
  }

  return Response.json({
    ...report,
    definition: REPORT_DEFINITIONS.find((definition) => definition.key === key),
    generatedAt: new Date().toISOString(),
  });
}
