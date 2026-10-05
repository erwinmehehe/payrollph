import { assertOrganizationRole, getAccess } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { buildCompliancePolicyReviewForOrganization } from "@/lib/compliance-policy-review-server";

export const dynamic = "force-dynamic";
const POLICY_REVIEW_ROLES = ["owner", "admin", "bookkeeper", "hr", "payroll", "checker"] as const;

function manilaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId) || organizationId <= 0) return Response.json({ error: "organizationId is required." }, { status: 400 });
  const denied = await assertOrganizationRole(user.id, organizationId, POLICY_REVIEW_ROLES, "You do not have permission to review company payroll policy controls.");
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) return Response.json({ error: "Policy review is company-wide and unavailable to unit-scoped roles." }, { status: 403 });
  try {
    const review = await buildCompliancePolicyReviewForOrganization(organizationId, manilaToday());
    return Response.json(review, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Policy review failed." }, { status: 422 });
  }
}