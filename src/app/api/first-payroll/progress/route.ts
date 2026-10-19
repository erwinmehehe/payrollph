import { getSessionUser } from "@/lib/auth";
import { assertMembership, getAccess } from "@/lib/access";
import { enforceSameOriginMutation } from "@/lib/security-request";
import { firstPayrollInlineAvailable } from "@/lib/first-payroll-inline-gate";
import { canReadFirstPayrollProgress, isJourneyKey, readJourneyProgress, saveJourneyProgress } from "@/lib/first-payroll-progress";
import { publicFirstPayrollProgressError } from "@/lib/first-payroll-public-errors";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!(await firstPayrollInlineAvailable()))
    return Response.json({error:"First-payroll inline setup is unavailable."},{status:404});
  const user = await getSessionUser();
  if (!user) return Response.json({error:"Sign in required"},{status:401});
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0)
    return Response.json({error:"Invalid employer"},{status:400});
  const denied = await assertMembership(user.id, organizationId);
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide || !canReadFirstPayrollProgress(access.role))
    return Response.json({error:"Journey progress requires an authorized company-wide role"},{status:403});
  return Response.json(
    { organizationId, progress: await readJourneyProgress(organizationId) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
export async function PATCH(request: Request) {
  if (!(await firstPayrollInlineAvailable()))
    return Response.json({error:"First-payroll inline setup is unavailable."},{status:404});
  const origin = enforceSameOriginMutation(request);
  if (origin) return origin;
  const user = await getSessionUser();
  if (!user) return Response.json({error:"Sign in required"},{status:401});
  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0 || !isJourneyKey(body.key))
    return Response.json({error:"Invalid employer or journey step"},{status:400});
  const denied = await assertMembership(user.id, organizationId);
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide || !canReadFirstPayrollProgress(access.role))
    return Response.json({error:"Journey progress requires an authorized company-wide role"},{status:403});
  if (!["handoff","time_review","company_confirm"].includes(body.action))
    return Response.json({error:"Unknown journey action"},{status:422});
  try {
    await saveJourneyProgress({
      organizationId, userId:user.id, userName:user.name, role:access.role,
      key:body.key, action:body.action, targetRole:body.targetRole,
      periodStart:body.periodStart, periodEnd:body.periodEnd, acknowledged:body.acknowledged,
    });
    return Response.json({progress:await readJourneyProgress(organizationId)});
  } catch (error) {
    return Response.json({error:publicFirstPayrollProgressError(error)},{status:422});
  }
}
