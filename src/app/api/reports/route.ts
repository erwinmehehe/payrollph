import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { REPORT_DEFINITIONS, reportToCsv, runReport, type ReportKey } from "@/lib/reports";
import { assertPermission } from "@/lib/access";

export const dynamic = "force-dynamic";

const VALID: ReportKey[] = ["headcount", "cost", "turnover", "compliance"];

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const organizationId = Number(searchParams.get("organizationId") ?? "1");
  const deniedOrg = await assertPermission(user.id, organizationId, "reports:read");
  if (deniedOrg) return deniedOrg;
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
