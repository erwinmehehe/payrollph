import { assertOrganizationRole, getAccess } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { enforceSameOriginMutation } from "@/lib/security-request";
import { loadFirstPayrollPreview, validFirstPayrollPreviewDates } from "@/lib/first-payroll-preview";

export const dynamic = "force-dynamic";
const PREVIEW_ROLES = ["owner", "admin", "bookkeeper", "hr", "payroll", "checker"] as const;

export async function POST(request: Request) {
  if (!criticalReleaseFlagEnabled("firstPayrollInline"))
    return Response.json({ error: "Inline first-payroll preview is disabled." }, { status: 404 });
  const origin = enforceSameOriginMutation(request);
  if (origin) return origin;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const start = typeof body.periodStart === "string" ? body.periodStart : "";
  const end = typeof body.periodEnd === "string" ? body.periodEnd : "";
  const payDate = typeof body.payDate === "string" ? body.payDate : "";
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0 ||
      !validFirstPayrollPreviewDates(start,end,payDate))
    return Response.json({ error: "Select valid cutoff and pay dates (maximum 16 days)." }, { status: 422 });
  const denied = await assertOrganizationRole(user.id,organizationId,PREVIEW_ROLES);
  if (denied) return denied;
  const access = await getAccess(user.id,organizationId);
  if (!access) return Response.json({ error: "Unauthorized employer." }, { status: 403 });
  const rawUnitId = body.scopeOrgUnitId == null || body.scopeOrgUnitId === ""
    ? null : Number(body.scopeOrgUnitId);
  if (rawUnitId !== null && (!Number.isSafeInteger(rawUnitId) || rawUnitId <= 0))
    return Response.json({ error: "Invalid unit scope." }, { status: 400 });
  if (!access.companyWide && rawUnitId !== null && rawUnitId !== access.orgUnitId)
    return Response.json({ error: "Unit is outside your assigned scope." }, { status: 403 });
  const orgUnitId = access.companyWide ? rawUnitId : access.orgUnitId;
  // DO NOT create a draft or call enqueuePayrollRun: this endpoint is SELECT +
  // the synchronous pure calculator only. No audit writes for every preview.
  try {
    const preview = await loadFirstPayrollPreview({
      organizationId, orgUnitId, periodStart:start, periodEnd:end, payDate,
    });
    return Response.json(preview, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Payroll preview unavailable.",
    }, { status: 422 });
  }
}
