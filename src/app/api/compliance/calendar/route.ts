import { assertOrganizationRole, getAccess } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { loadComplianceCalendar } from "@/lib/compliance-calendar-server";
import { buildStatutoryRuleWatch } from "@/lib/statutory-rule-watch";

export const dynamic = "force-dynamic";

const COMPLIANCE_CALENDAR_ROLES = ["owner", "admin", "bookkeeper", "hr", "payroll", "checker"] as const;

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    COMPLIANCE_CALENDAR_ROLES,
    "Your role cannot view the company compliance calendar.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({
      error: "The statutory compliance calendar is company-wide and is not available to unit-scoped roles.",
    }, { status: 403 });
  }

  const calendar = await loadComplianceCalendar(organizationId);
  if (calendar.kind === "not-found") return Response.json({ error: "Organization not found." }, { status: 404 });
  if (calendar.kind === "empty") {
    return Response.json({
      today: calendar.today,
      applicableMonths: [],
      items: [],
      ruleWatch: buildStatutoryRuleWatch(calendar.today),
      note: "The compliance calendar starts when payroll periods exist.",
    }, { headers: { "Cache-Control": "no-store" } });
  }

  return Response.json({
    today: calendar.today,
    applicableMonths: calendar.applicableMonths,
    items: calendar.items,
    ruleWatch: buildStatutoryRuleWatch(calendar.today),
    note: "Dates are nominal statutory dates or conservative internal targets. Published agency calendars, filer classification, weekends and holidays can change the final filing/payment date.",
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}
