import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess, PAYROLL_OPERATOR_ROLES } from "@/lib/access";
import { enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";
import { priorEvidenceEnabled, priorIntake } from "@/lib/year-end-prior-evidence-server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
async function respond(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers });
  if (!priorEvidenceEnabled()) return Response.json({ error: "Not enabled." }, { status: 404, headers });
  const origin = enforceSameOriginMutation(request); if (origin) return origin;
  const query = new URL(request.url).searchParams;
  const scope = { organizationId: Number(query.get("organizationId")), employeeId: Number(query.get("employeeId")), taxYear: Number(query.get("taxYear")) };
  if (![scope.organizationId, scope.employeeId].every(n => Number.isSafeInteger(n) && n > 0) || !Number.isInteger(scope.taxYear) || scope.taxYear < 2023 || scope.taxYear > 2100) return Response.json({ error: "Select an employer, employee and year from 2023 onward." }, { status: 400, headers });
  const denied = await assertOrganizationRole(user.id, scope.organizationId, PAYROLL_OPERATOR_ROLES); if (denied) return denied;
  if (!(await getAccess(user.id, scope.organizationId))?.companyWide) return Response.json({ error: "Company-wide payroll access required." }, { status: 403, headers });
  const mfa = requireSensitiveActionMfa(user); if (mfa) return mfa;
  try {
    let input;
    if (request.method === "POST") {
      const text = await request.text();
      if (text.length > 8192) return Response.json({ error: "Evidence too large." }, { status: 413, headers });
      try { input = JSON.parse(text); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400, headers }); }
      if (!input || typeof input !== "object" || Array.isArray(input)) return Response.json({ error: "Invalid request." }, { status: 400, headers });
    }
    return Response.json({ record: await priorIntake(scope, user, input) }, { headers });
  } catch (error) {
    const code = error instanceof Error && /^(PRIOR_|PERA_)/.test(error.message) ? error.message : "PRIOR_INTAKE_UNAVAILABLE";
    return Response.json({ error: "Evidence could not be loaded or changed. Reload and review the current source; bound or settled payroll requires a separate correction.", code }, { status: 409, headers });
  }
}
export const GET = respond;
export const POST = respond;
