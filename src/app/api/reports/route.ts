import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { REPORT_DEFINITIONS, reportToCsv, runReport, type ReportKey } from "@/lib/reports";
import { assertOrganizationRole, getAccess, PEOPLE_PAYROLL_ROLES } from "@/lib/access";

export const dynamic = "force-dynamic";

const VALID: ReportKey[] = ["headcount", "cost", "turnover", "compliance", "assurance", "workforce", "lifecycle"];

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

  const report = await runReport(key, organizationId);

  if (format === "csv") {
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Report exported",
      resource: key,
      metadata: { format: "csv", rows: report.rows.length },
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
