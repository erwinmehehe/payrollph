import { assertOrganizationRole, PAYROLL_OPERATOR_ROLES } from "@/lib/access";
import { loadFirstPayrollPreview } from "@/lib/first-payroll-preview-server";
import { journeyAccess } from "@/lib/first-payroll-journey-access";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  const auth = await journeyAccess(organizationId, true);
  if (auth instanceof Response) return auth;
  const denied = await assertOrganizationRole(auth.user.id, organizationId, PAYROLL_OPERATOR_ROLES, "Only payroll operators can inspect employee pay.");
  if (denied) return denied;
  try {
    return Response.json(await loadFirstPayrollPreview(organizationId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Preview inputs could not be calculated." }, { status: 422 });
  }
}
